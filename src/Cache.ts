/**
 * @module Cache
 *
 * Effect-wrapped Cloudflare Cache API.
 *
 * Provides a fully typed, Effect-based interface to the Cloudflare Cache API with:
 * - `match` / `matchOrFail` for cache lookups
 * - `put` / `delete` for cache writes and invalidation
 * - JSON mode with optional Schema validation via `Cache.json(schema)`
 * - Default cache and named cache support
 * - Automatic tracing spans via `Effect.fn`
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Cache } from "effectful-cloudflare/Cache"
 *
 * const program = Effect.gen(function*() {
 *   const cache = yield* Cache
 *   yield* cache.put("https://example.com/api/data", new Response("cached"))
 *   const hit = yield* cache.match("https://example.com/api/data")
 * }).pipe(Effect.provide(Cache.defaultCache()))
 * ```
 */

import { Data, Effect, Layer, Schema, ServiceMap } from "effect";
import * as Errors from "./Errors.js";

// ── Binding type ───────────────────────────────────────────────────────

/**
 * Minimal structural type for Cloudflare Cache API binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It extracts only the methods
 * we need from the native Cache interface.
 *
 * @example
 * ```ts
 * // Use with Cloudflare's default cache
 * const binding: CacheBinding = caches.default
 *
 * // Or use with named cache
 * const binding: CacheBinding = await caches.open("my-cache")
 *
 * // Or use with test mock
 * const binding: CacheBinding = Testing.memoryCache()
 * ```
 */
export interface CacheBinding {
  delete(
    request: Request | string,
    options?: CacheQueryOptions
  ): Promise<boolean>;
  match(
    request: Request | string,
    options?: CacheQueryOptions
  ): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}

/**
 * Options for Cache query operations.
 *
 * @property ignoreMethod - If true, ignore the request method when matching (default: false)
 */
export interface CacheQueryOptions {
  readonly ignoreMethod?: boolean;
}

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * Cache operation failed.
 *
 * Module-specific error wrapping Cloudflare Cache API exceptions.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new CacheError({
 *   operation: "match",
 *   message: "Failed to retrieve cached response",
 *   cause: nativeError
 * })
 * ```
 */
export class CacheError extends Data.TaggedError("CacheError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Schema constraint ──────────────────────────────────────────────────

/**
 * Schema constraint for Cache JSON mode.
 *
 * Requires that the schema has no service dependencies (DecodingServices and
 * EncodingServices are both `never`). This ensures that all encode/decode
 * operations can run without requiring additional services in the Effect context.
 */
type PureSchema<A> = Schema.Schema<A> & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

// ── Cache Service ──────────────────────────────────────────────────────

/**
 * Cache service — Effect-wrapped Cloudflare Cache API.
 *
 * Provides Effect-based operations for Cloudflare's global cache with:
 * - Automatic error handling and typed errors
 * - Schema validation support via `.json()` factory
 * - Support for both default and named caches
 * - Automatic tracing with `Effect.fn`
 *
 * @example
 * ```ts
 * // Use with default cache
 * const cacheLayer = Cache.layer(caches.default)
 *
 * const program = Effect.gen(function*() {
 *   const cache = yield* Cache
 *   const response = yield* cache.match("https://example.com")
 *   if (response !== null) {
 *     console.log(yield* Effect.promise(() => response.text()))
 *   }
 * })
 *
 * // Or use helper for default cache
 * const layer = Cache.defaultCache()
 * ```
 */
export class Cache extends ServiceMap.Service<
  Cache,
  {
    readonly match: (
      request: Request | string,
      options?: CacheQueryOptions
    ) => Effect.Effect<Response | null, CacheError>;
    readonly matchOrFail: (
      request: Request | string,
      options?: CacheQueryOptions
    ) => Effect.Effect<Response, CacheError | Errors.NotFoundError>;
    readonly put: (
      request: Request | string,
      response: Response
    ) => Effect.Effect<void, CacheError>;
    readonly delete: (
      request: Request | string,
      options?: CacheQueryOptions
    ) => Effect.Effect<boolean, CacheError>;
  }
>()("effectful-cloudflare/Cache") {
  /**
   * Create a Cache service from a binding.
   *
   * This static method wraps all Cache operations in Effect programs with:
   * - Automatic error handling via `Effect.tryPromise`
   * - Typed errors (`CacheError`, `NotFoundError`)
   * - Automatic tracing spans via `Effect.fn`
   * - Maps `undefined` responses to `null` for consistency
   *
   * @param binding - Cache binding (e.g., `caches.default` or from `caches.open()`)
   * @returns Effect that yields the Cache service
   *
   * @example
   * ```ts
   * const program = Effect.gen(function*() {
   *   const cache = yield* Cache.make(caches.default)
   *   const response = yield* cache.match("https://example.com")
   * })
   * ```
   */
  static make = (binding: CacheBinding) =>
    Effect.gen(function* () {
      const match = Effect.fn("Cache.match")(function* (
        request: Request | string,
        options?: CacheQueryOptions
      ) {
        yield* Effect.logDebug("Cache.match").pipe(
          Effect.annotateLogs({
            url: typeof request === "string" ? request : request.url,
          })
        );
        return yield* Effect.tryPromise({
          try: async () => {
            const response = await binding.match(request, options);
            // Map undefined to null for consistency with other modules
            return response ?? null;
          },
          catch: (cause) =>
            new CacheError({
              operation: "match",
              message: "Failed to match cache entry",
              cause,
            }),
        });
      });

      const matchOrFail = Effect.fn("Cache.matchOrFail")(function* (
        request: Request | string,
        options?: CacheQueryOptions
      ) {
        yield* Effect.logDebug("Cache.matchOrFail").pipe(
          Effect.annotateLogs({
            url: typeof request === "string" ? request : request.url,
          })
        );
        const response = yield* match(request, options);
        if (response === null) {
          const url = typeof request === "string" ? request : request.url;
          return yield* Effect.fail(
            new Errors.NotFoundError({
              resource: "Cache",
              key: url,
            })
          );
        }
        return response;
      });

      const put = Effect.fn("Cache.put")(function* (
        request: Request | string,
        response: Response
      ) {
        yield* Effect.logDebug("Cache.put").pipe(
          Effect.annotateLogs({
            url: typeof request === "string" ? request : request.url,
          })
        );
        return yield* Effect.tryPromise({
          try: () => binding.put(request, response),
          catch: (cause) =>
            new CacheError({
              operation: "put",
              message: "Failed to put cache entry",
              cause,
            }),
        });
      });

      const del = Effect.fn("Cache.delete")(function* (
        request: Request | string,
        options?: CacheQueryOptions
      ) {
        yield* Effect.logDebug("Cache.delete").pipe(
          Effect.annotateLogs({
            url: typeof request === "string" ? request : request.url,
          })
        );
        return yield* Effect.tryPromise({
          try: () => binding.delete(request, options),
          catch: (cause) =>
            new CacheError({
              operation: "delete",
              message: "Failed to delete cache entry",
              cause,
            }),
        });
      });

      return {
        match,
        matchOrFail,
        put,
        delete: del,
      };
    });

  /**
   * Create a Layer from a Cache binding.
   *
   * This is the standard way to provide Cache service to Effect programs.
   *
   * @param binding - Cache binding
   * @returns Layer providing Cache service
   *
   * @example
   * ```ts
   * const layer = Cache.layer(caches.default)
   *
   * const program = Effect.gen(function*() {
   *   const cache = yield* Cache
   *   yield* cache.put("https://example.com", response)
   * }).pipe(Effect.provide(layer))
   * ```
   */
  static layer = (binding: CacheBinding) =>
    Layer.effect(this, this.make(binding));

  /**
   * Create schema-validated Cache variant (JSON mode).
   *
   * Returns a factory with `make` and `layer` methods that automatically:
   * - Decode JSON response bodies after retrieval
   * - Validate against the provided schema
   * - Encode values to JSON before storing
   * - Add `SchemaError` to the error channel
   *
   * @param schema - Schema.Schema for encoding/decoding values
   * @returns Factory with `make` and `layer` methods
   *
   * @example
   * ```ts
   * const UserSchema = Schema.Struct({
   *   id: Schema.String,
   *   name: Schema.String,
   *   email: Schema.String,
   * })
   * type User = Schema.Schema.Type<typeof UserSchema>
   *
   * const userCache = Cache.json(UserSchema)
   * const layer = userCache.layer(caches.default)
   *
   * const program = Effect.gen(function*() {
   *   const cache = yield* Cache
   *   // Fully typed - returns User | null
   *   const user: User | null = yield* cache.match("https://api.example.com/user/123")
   *   // Fully typed - accepts User
   *   yield* cache.put(
   *     "https://api.example.com/user/456",
   *     { id: "456", name: "Bob", email: "bob@x.com" }
   *   )
   * }).pipe(Effect.provide(layer))
   * ```
   */
  static json = <A>(schema: PureSchema<A>) => ({
    make: (binding: CacheBinding) =>
      Effect.gen(function* () {
        const baseCache = yield* Cache.make(binding);

        const match = Effect.fn("Cache.json.match")(function* (
          request: Request | string,
          options?: CacheQueryOptions
        ) {
          const response = yield* baseCache.match(request, options);
          if (response === null) {
            return null as A | null;
          }

          const text = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (cause) =>
              new CacheError({
                operation: "match",
                message: "Failed to read response body",
                cause,
              }),
          });

          const parsed = yield* Effect.try({
            try: () => JSON.parse(text),
            catch: (cause) =>
              new Errors.SchemaError({
                message: "Failed to parse JSON from cache response",
                cause: cause as Error,
              }),
          });

          return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
            Effect.mapError(
              (cause) =>
                new Errors.SchemaError({
                  message: "Schema validation failed for cached response",
                  cause: cause as Error,
                })
            )
          );
        });

        const matchOrFail = Effect.fn("Cache.json.matchOrFail")(function* (
          request: Request | string,
          options?: CacheQueryOptions
        ) {
          const value = yield* match(request, options);
          if (value === null) {
            const url = typeof request === "string" ? request : request.url;
            return yield* Effect.fail(
              new Errors.NotFoundError({
                resource: "Cache",
                key: url,
              })
            );
          }
          return value;
        });

        const put = Effect.fn("Cache.json.put")(function* (
          request: Request | string,
          value: A
        ) {
          const encoded = yield* Schema.encodeEffect(schema)(value).pipe(
            Effect.mapError(
              (cause) =>
                new Errors.SchemaError({
                  message: "Schema encoding failed for cache value",
                  cause: cause as Error,
                })
            )
          );

          const json = yield* Effect.try({
            try: () => JSON.stringify(encoded),
            catch: (cause) =>
              new Errors.SchemaError({
                message: "Failed to stringify JSON for cache",
                cause: cause as Error,
              }),
          });

          const response = new Response(json, {
            headers: {
              "Content-Type": "application/json",
            },
          });

          return yield* baseCache.put(request, response);
        });

        // Return service with typed methods
        // Note: This object is structurally compatible with Cache service,
        // but uses generic type A instead of Response for values.
        return {
          match,
          matchOrFail,
          put,
          delete: baseCache.delete,
        };
      }),
    layer: (binding: CacheBinding) =>
      Layer.effect(
        Cache,
        // Type assertion is safe: we provide a Cache-compatible service with
        // schema-validated types (A instead of Response). The Layer system
        // handles this correctly at runtime since the shape is identical.
        Cache.json(schema).make(binding) as unknown as ReturnType<
          typeof Cache.make
        >
      ),
  });

  /**
   * Create a Layer for Cloudflare's default cache.
   *
   * This is a convenience method for accessing the global `caches.default`
   * cache. Note that this requires access to the global `caches` object,
   * which is only available in Cloudflare Workers runtime.
   *
   * @returns Layer providing Cache service for default cache
   *
   * @example
   * ```ts
   * const program = Effect.gen(function*() {
   *   const cache = yield* Cache
   *   const response = yield* cache.match("https://example.com")
   * }).pipe(Effect.provide(Cache.defaultCache()))
   * ```
   */
  static defaultCache = () => Cache.layer(caches.default);

  /**
   * Create a Layer for a named Cloudflare cache.
   *
   * This is a convenience method for accessing named caches via `caches.open()`.
   * Note that this requires access to the global `caches` object and returns
   * an effectful Layer since cache opening is async.
   *
   * @param name - Name of the cache to open
   * @returns Effect that yields a Layer providing Cache service
   *
   * @example
   * ```ts
   * const program = Effect.gen(function*() {
   *   const layer = yield* Cache.namedCache("my-cache")
   *   const result = yield* Effect.gen(function*() {
   *     const cache = yield* Cache
   *     return yield* cache.match("https://example.com")
   *   }).pipe(Effect.provide(layer))
   * })
   * ```
   */
  static namedCache = (name: string) =>
    Effect.gen(function* () {
      const binding = yield* Effect.tryPromise({
        try: () => caches.open(name),
        catch: (cause) =>
          new CacheError({
            operation: "open",
            message: `Failed to open named cache: ${name}`,
            cause,
          }),
      });
      return Cache.layer(binding);
    });
}
