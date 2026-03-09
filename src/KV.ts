/**
 * @module KV
 *
 * Effect-wrapped Cloudflare Workers KV key-value storage.
 *
 * Provides a fully typed, Effect-based interface to Cloudflare KV with:
 * - Automatic JSON serialization/deserialization
 * - Optional Schema validation (pass a schema to `make`/`layer`)
 * - `getOrFail` variant that fails with `NotFoundError`
 * - Metadata and expiration support
 * - Cursor-based list pagination
 * - Multi-namespace support via `KVMap` (LayerMap)
 * - Automatic tracing spans via `Effect.fn`
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { KV } from "effectful-cloudflare/KV"
 *
 * const program = Effect.gen(function*() {
 *   const kv = yield* KV
 *   yield* kv.put("key", "value")
 *   const value = yield* kv.getOrFail("key")
 * }).pipe(Effect.provide(KV.layer(env.MY_KV)))
 * ```
 */

import { Data, Effect, Layer, LayerMap, Schema, ServiceMap } from "effect";
import * as Errors from "./Errors.js";
import { WorkerEnv } from "./Worker.js";

// ── Binding type ───────────────────────────────────────────────────────

/**
 * Minimal structural type for KVNamespace binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It extracts only the methods
 * we need from the native KVNamespace interface.
 *
 * @example
 * ```ts
 * // Use with native Cloudflare binding
 * const binding: KVBinding = env.MY_KV
 *
 * // Or use with test mock
 * const binding: KVBinding = Testing.memoryKV()
 * ```
 */
export interface KVBinding {
  delete(key: string): Promise<void>;
  get(
    key: string,
    options?: { type?: string; cacheTtl?: number }
  ): Promise<string | null>;
  getWithMetadata<M = unknown>(
    key: string,
    options?: { type?: string; cacheTtl?: number }
  ): Promise<{ value: string | null; metadata: M | null }>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: ReadonlyArray<{
      name: string;
      expiration?: number;
      metadata?: unknown;
    }>;
    list_complete: boolean;
    cursor?: string;
  }>;
  put(
    key: string,
    value: string,
    options?: {
      expiration?: number;
      expirationTtl?: number;
      metadata?: unknown;
    }
  ): Promise<void>;
}

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * KV operation failed.
 *
 * Module-specific error wrapping Cloudflare KV exceptions.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new KVError({
 *   operation: "get",
 *   key: "user:123",
 *   cause: nativeError
 * })
 * ```
 */
export class KVError extends Data.TaggedError("KVError")<{
  readonly operation: string;
  readonly message: string;
  readonly key?: string;
  readonly cause?: unknown;
}> {}

// ── Options types ──────────────────────────────────────────────────────

/**
 * Options for KV get operations.
 *
 * @property cacheTtl - How long (in seconds) the value should be cached in edge locations
 */
export interface KVGetOptions {
  readonly cacheTtl?: number;
}

/**
 * Options for KV put operations.
 *
 * @property expiration - Absolute Unix timestamp (in seconds) when the key should expire
 * @property expirationTtl - Relative time (in seconds) from now when the key should expire
 * @property metadata - Arbitrary metadata to associate with the key-value pair
 */
export interface KVPutOptions {
  readonly expiration?: number;
  readonly expirationTtl?: number;
  readonly metadata?: unknown;
}

/**
 * Options for KV list operations.
 *
 * @property prefix - Only return keys that begin with this prefix
 * @property limit - Maximum number of keys to return (default: 1000, max: 1000)
 * @property cursor - Pagination cursor from a previous list operation
 */
export interface KVListOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly prefix?: string;
}

// ── Result types ───────────────────────────────────────────────────────

/**
 * Value with metadata returned from getWithMetadata.
 *
 * @template V - Type of the value
 * @template M - Type of the metadata
 */
export interface KVValueWithMetadata<V, M> {
  readonly metadata: M | null;
  readonly value: V;
}

/**
 * Result of a KV list operation.
 *
 * @property keys - Array of keys with optional expiration and metadata
 * @property list_complete - Whether all matching keys were returned (not truncated)
 * @property cursor - Pagination cursor for fetching the next page (if truncated)
 */
export interface KVListResult {
  readonly cursor?: string;
  readonly keys: ReadonlyArray<{
    name: string;
    expiration?: number;
    metadata?: unknown;
  }>;
  readonly list_complete: boolean;
}

// ── Schema constraint ──────────────────────────────────────────────────

/** A Schema that requires no external services for encoding/decoding. */
type PureSchema<A> = Schema.Schema<A> & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

// ── KV Service ─────────────────────────────────────────────────────────

/**
 * KV service — Effect-wrapped Cloudflare Workers KV with built-in JSON serialization.
 *
 * All values are automatically JSON serialized/deserialized. When used without
 * a schema, values are `unknown`. When used with a schema, values are fully typed.
 *
 * Provides Effect-based operations for Cloudflare Workers KV storage with:
 * - Built-in JSON serialization (no manual stringify/parse)
 * - Optional schema validation for full type safety
 * - Automatic error handling and typed errors
 * - Multi-instance support via `KVMap`
 * - Automatic tracing with `Effect.fn`
 *
 * @example
 * ```ts
 * // Untyped — values are `unknown`
 * const program = Effect.gen(function*() {
 *   const kv = yield* KV
 *   yield* kv.put("key", { any: "value" })
 *   const value: unknown = yield* kv.get("key")
 * }).pipe(Effect.provide(KV.layer(env.MY_KV)))
 *
 * // Typed with schema — values are fully typed
 * const UserSchema = Schema.Struct({ id: Schema.String, name: Schema.String })
 * const program2 = Effect.gen(function*() {
 *   const kv = yield* KV
 *   yield* kv.put("user:123", { id: "123", name: "Alice" })  // typechecked
 *   const user = yield* kv.get("user:123")  // User | null
 * }).pipe(Effect.provide(KV.layer(env.MY_KV, UserSchema)))
 * ```
 */
export class KV extends ServiceMap.Service<
  KV,
  {
    readonly get: (
      key: string,
      options?: KVGetOptions
    ) => Effect.Effect<unknown, KVError | Errors.SchemaError>;
    readonly getOrFail: (
      key: string,
      options?: KVGetOptions
    ) => Effect.Effect<
      unknown,
      KVError | Errors.SchemaError | Errors.NotFoundError
    >;
    readonly getWithMetadata: <M = unknown>(
      key: string,
      options?: KVGetOptions
    ) => Effect.Effect<
      KVValueWithMetadata<unknown, M>,
      KVError | Errors.SchemaError
    >;
    readonly put: (
      key: string,
      value: unknown,
      options?: KVPutOptions
    ) => Effect.Effect<void, KVError | Errors.SchemaError>;
    readonly delete: (key: string) => Effect.Effect<void, KVError>;
    readonly list: (
      options?: KVListOptions
    ) => Effect.Effect<KVListResult, KVError>;
  }
>()("effectful-cloudflare/KV") {
  /**
   * Create a KV service from a binding.
   *
   * All values are automatically JSON serialized on write and deserialized
   * on read. Pass an optional schema for full type safety and validation.
   *
   * @param binding - KV namespace binding from worker environment
   * @param schema - Optional schema for encoding/decoding values
   * @returns Effect that yields the KV service
   *
   * @example
   * ```ts
   * // Untyped
   * const kv = yield* KV.make(env.MY_KV)
   * yield* kv.put("key", { hello: "world" })
   *
   * // Typed with schema
   * const kv = yield* KV.make(env.MY_KV, UserSchema)
   * yield* kv.put("user:1", { id: "1", name: "Alice" })  // typechecked
   * ```
   */
  static make<A = unknown>(binding: KVBinding, schema?: PureSchema<A>) {
    return Effect.gen(function* () {
      // ── Serialization helpers ──────────────────────────────────────
      const encode = schema ? Schema.encodeSync(schema) : undefined;
      const decode = schema ? Schema.decodeUnknownSync(schema) : undefined;

      const serialize = (value: unknown, key: string) =>
        Effect.gen(function* () {
          // Schema encode (if schema provided)
          const toEncode = encode
            ? yield* Effect.try({
                try: () => encode(value as A),
                catch: (cause) =>
                  new Errors.SchemaError({
                    message: `Schema encoding failed for KV key: ${key}`,
                    cause: cause as Error,
                  }),
              })
            : value;
          // JSON stringify
          return yield* Effect.try({
            try: () => JSON.stringify(toEncode),
            catch: (cause) =>
              new KVError({
                operation: "put",
                message: `Failed to serialize value for key: ${key}`,
                key,
                cause,
              }),
          });
        });

      const deserialize = (raw: string, key: string) =>
        Effect.gen(function* () {
          // JSON parse
          const parsed = yield* Effect.try({
            try: () => JSON.parse(raw),
            catch: (cause) =>
              new KVError({
                operation: "get",
                message: `Failed to parse JSON for key: ${key}`,
                key,
                cause,
              }),
          });
          // Schema decode (if schema provided)
          if (decode) {
            return yield* Effect.try({
              try: () => decode(parsed),
              catch: (cause) =>
                new Errors.SchemaError({
                  message: `Schema decoding failed for KV key: ${key}`,
                  cause: cause as Error,
                }),
            });
          }
          return parsed as unknown;
        });

      // ── Service methods ───────────────────────────────────────────

      const get = Effect.fn("KV.get")(function* (
        key: string,
        options?: KVGetOptions
      ) {
        yield* Effect.logDebug("KV.get").pipe(
          Effect.annotateLogs({
            key,
            ...(options?.cacheTtl !== undefined && {
              cacheTtl: options.cacheTtl,
            }),
          })
        );
        const raw = yield* Effect.tryPromise({
          try: () =>
            binding.get(key, {
              type: "text",
              ...(options?.cacheTtl !== undefined && {
                cacheTtl: options.cacheTtl,
              }),
            }),
          catch: (cause) =>
            new KVError({
              operation: "get",
              message: `Failed to get key: ${key}`,
              key,
              cause,
            }),
        });

        if (raw === null) {
          return null;
        }

        return yield* deserialize(raw, key);
      });

      const getOrFail = Effect.fn("KV.getOrFail")(function* (
        key: string,
        options?: KVGetOptions
      ) {
        yield* Effect.logDebug("KV.getOrFail").pipe(
          Effect.annotateLogs({ key })
        );
        const value = yield* get(key, options);
        if (value === null) {
          return yield* Effect.fail(
            new Errors.NotFoundError({
              resource: "KV",
              key,
            })
          );
        }
        return value;
      });

      const getWithMetadata = Effect.fn("KV.getWithMetadata")(function* <
        M = unknown,
      >(key: string, options?: KVGetOptions) {
        yield* Effect.logDebug("KV.getWithMetadata").pipe(
          Effect.annotateLogs({ key })
        );
        const result = yield* Effect.tryPromise({
          try: () =>
            binding.getWithMetadata<M>(key, {
              type: "text",
              ...(options?.cacheTtl !== undefined && {
                cacheTtl: options.cacheTtl,
              }),
            }),
          catch: (cause) =>
            new KVError({
              operation: "getWithMetadata",
              message: `Failed to get key with metadata: ${key}`,
              key,
              cause,
            }),
        });

        if (result.value === null) {
          return {
            value: null,
            metadata: result.metadata,
          } satisfies KVValueWithMetadata<unknown, M>;
        }

        const decoded = yield* deserialize(result.value, key);
        return {
          value: decoded,
          metadata: result.metadata,
        } satisfies KVValueWithMetadata<unknown, M>;
      });

      const put = Effect.fn("KV.put")(function* (
        key: string,
        value: unknown,
        options?: KVPutOptions
      ) {
        yield* Effect.logDebug("KV.put").pipe(
          Effect.annotateLogs({
            key,
            ...(options?.expirationTtl !== undefined && {
              expirationTtl: options.expirationTtl,
            }),
          })
        );
        const json = yield* serialize(value, key);
        return yield* Effect.tryPromise({
          try: () => binding.put(key, json, options),
          catch: (cause) =>
            new KVError({
              operation: "put",
              message: `Failed to put key: ${key}`,
              key,
              cause,
            }),
        });
      });

      const del = Effect.fn("KV.delete")(function* (key: string) {
        yield* Effect.logDebug("KV.delete").pipe(Effect.annotateLogs({ key }));
        return yield* Effect.tryPromise({
          try: () => binding.delete(key),
          catch: (cause) =>
            new KVError({
              operation: "delete",
              message: `Failed to delete key: ${key}`,
              key,
              cause,
            }),
        });
      });

      const list = Effect.fn("KV.list")(function* (options?: KVListOptions) {
        yield* Effect.logDebug("KV.list").pipe(
          Effect.annotateLogs({
            ...(options?.prefix !== undefined && { prefix: options.prefix }),
            ...(options?.limit !== undefined && { limit: options.limit }),
          })
        );
        return yield* Effect.tryPromise({
          try: () => binding.list(options),
          catch: (cause) =>
            new KVError({
              operation: "list",
              message: "Failed to list keys",
              cause,
            }),
        });
      });

      return {
        get,
        getOrFail,
        getWithMetadata,
        put,
        delete: del,
        list,
      };
    });
  }

  /**
   * Create a Layer from a KV binding (untyped — values are `unknown`).
   *
   * @param binding - KV namespace binding from worker environment
   * @returns Layer providing KV service
   *
   * @example
   * ```ts
   * const layer = KV.layer(env.MY_KV)
   *
   * const program = Effect.gen(function*() {
   *   const kv = yield* KV
   *   yield* kv.put("key", { any: "value" })
   * }).pipe(Effect.provide(layer))
   * ```
   */
  static layer(binding: KVBinding): Layer.Layer<KV>;

  /**
   * Create a Layer from a KV binding with schema validation (fully typed).
   *
   * @param binding - KV namespace binding from worker environment
   * @param schema - Schema for encoding/decoding values
   * @returns Layer providing KV service
   *
   * @example
   * ```ts
   * const UserSchema = Schema.Struct({ id: Schema.String, name: Schema.String })
   * const layer = KV.layer(env.MY_KV, UserSchema)
   *
   * const program = Effect.gen(function*() {
   *   const kv = yield* KV
   *   yield* kv.put("user:1", { id: "1", name: "Alice" })  // typechecked
   *   const user = yield* kv.get("user:1")  // User | null
   * }).pipe(Effect.provide(layer))
   * ```
   */
  static layer<A>(binding: KVBinding, schema: PureSchema<A>): Layer.Layer<KV>;

  static layer<A>(binding: KVBinding, schema?: PureSchema<A>) {
    return schema
      ? Layer.effect(KV, KV.make(binding, schema))
      : Layer.effect(KV, KV.make(binding));
  }
}

// ── KVMap LayerMap for Multi-Instance ──────────────────────────────────

/**
 * KVMap — Multi-instance KV service using LayerMap.
 *
 * Allows dynamic resolution of multiple KV namespaces by binding name.
 * Useful when you have multiple KV bindings and need to access them
 * by name at runtime.
 *
 * @example
 * ```ts
 * // Define the KVMap layer (typically in your layer composition)
 * const layers = Layer.mergeAll(
 *   WorkerEnv.layer(env),
 *   KVMap.layer
 * )
 *
 * // Use different KV namespaces dynamically
 * const program = Effect.gen(function*() {
 *   // Access KV_USERS namespace
 *   const usersKV = yield* KV.pipe(
 *     Effect.provide(KVMap.get("KV_USERS"))
 *   )
 *   const user = yield* usersKV.get("user:123")
 *
 *   // Access KV_CACHE namespace
 *   const cacheKV = yield* KV.pipe(
 *     Effect.provide(KVMap.get("KV_CACHE"))
 *   )
 *   const cached = yield* cacheKV.get("cache:key")
 * })
 * ```
 */
export class KVMap extends LayerMap.Service<KVMap>()(
  "effectful-cloudflare/KVMap",
  {
    lookup: (name: string) =>
      Layer.effect(
        KV,
        Effect.gen(function* () {
          const env = yield* WorkerEnv;
          const binding = env[name] as KVBinding;
          return yield* KV.make(binding);
        })
      ),
    idleTimeToLive: "5 minutes",
  }
) {}
