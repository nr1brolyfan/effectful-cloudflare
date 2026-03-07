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
export type KVBinding = {
	get(
		key: string,
		options?: { type?: string; cacheTtl?: number },
	): Promise<string | null>;
	getWithMetadata<M = unknown>(
		key: string,
		options?: { type?: string; cacheTtl?: number },
	): Promise<{ value: string | null; metadata: M | null }>;
	put(
		key: string,
		value: string,
		options?: {
			expiration?: number;
			expirationTtl?: number;
			metadata?: unknown;
		},
	): Promise<void>;
	delete(key: string): Promise<void>;
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
};

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
	readonly key?: string;
	readonly cause: unknown;
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
	readonly prefix?: string;
	readonly limit?: number;
	readonly cursor?: string;
}

// ── Result types ───────────────────────────────────────────────────────

/**
 * Value with metadata returned from getWithMetadata.
 *
 * @template V - Type of the value
 * @template M - Type of the metadata
 */
export interface KVValueWithMetadata<V, M> {
	readonly value: V;
	readonly metadata: M | null;
}

/**
 * Result of a KV list operation.
 *
 * @property keys - Array of keys with optional expiration and metadata
 * @property list_complete - Whether all matching keys were returned (not truncated)
 * @property cursor - Pagination cursor for fetching the next page (if truncated)
 */
export interface KVListResult {
	readonly keys: ReadonlyArray<{
		name: string;
		expiration?: number;
		metadata?: unknown;
	}>;
	readonly list_complete: boolean;
	readonly cursor?: string;
}

// ── KV Service ─────────────────────────────────────────────────────────

/**
 * KV service — Effect-wrapped Cloudflare Workers KV.
 *
 * Provides Effect-based operations for Cloudflare Workers KV storage with:
 * - Automatic error handling and typed errors
 * - Schema validation support via `.json()` factory
 * - Multi-instance support via `KVMap`
 * - Automatic tracing with `Effect.fn`
 *
 * @example
 * ```ts
 * // Single instance
 * const kvLayer = KV.layer(env.MY_KV)
 *
 * const program = Effect.gen(function*() {
 *   const kv = yield* KV
 *   const value = yield* kv.get("key")
 *   yield* kv.put("key", "value", { expirationTtl: 3600 })
 * })
 *
 * // Schema-validated JSON mode
 * const UserSchema = Schema.Struct({ id: Schema.String, name: Schema.String })
 * const userKV = KV.json(UserSchema)
 * const program2 = Effect.gen(function*() {
 *   const kv = yield* KV
 *   const user = yield* kv.get("user:123") // fully typed
 * }).pipe(Effect.provide(userKV.layer(env.MY_KV)))
 * ```
 */
export class KV extends ServiceMap.Service<
	KV,
	{
		readonly get: (
			key: string,
			options?: KVGetOptions,
		) => Effect.Effect<string | null, KVError>;
		readonly getOrFail: (
			key: string,
			options?: KVGetOptions,
		) => Effect.Effect<string, KVError | Errors.NotFoundError>;
		readonly getWithMetadata: <M = unknown>(
			key: string,
			options?: KVGetOptions,
		) => Effect.Effect<KVValueWithMetadata<string | null, M>, KVError>;
		readonly put: (
			key: string,
			value: string,
			options?: KVPutOptions,
		) => Effect.Effect<void, KVError>;
		readonly delete: (key: string) => Effect.Effect<void, KVError>;
		readonly list: (
			options?: KVListOptions,
		) => Effect.Effect<KVListResult, KVError>;
	}
>()("effectful-cloudflare/KV") {
	/**
	 * Create a KV service from a binding.
	 *
	 * This static method wraps all KV operations in Effect programs with:
	 * - Automatic error handling via `Effect.tryPromise`
	 * - Typed errors (`KVError`, `NotFoundError`)
	 * - Automatic tracing spans via `Effect.fn`
	 *
	 * @param binding - KV namespace binding from worker environment
	 * @returns Effect that yields the KV service
	 *
	 * @example
	 * ```ts
	 * const program = Effect.gen(function*() {
	 *   const kv = yield* KV.make(env.MY_KV)
	 *   const value = yield* kv.get("key")
	 * })
	 * ```
	 */
	static make = (binding: KVBinding) =>
		Effect.gen(function* () {
			const get = Effect.fn("KV.get")(function* (
				key: string,
				options?: KVGetOptions,
			) {
				return yield* Effect.tryPromise({
					try: () =>
						binding.get(key, {
							type: "text",
							...(options?.cacheTtl !== undefined && {
								cacheTtl: options.cacheTtl,
							}),
						}),
					catch: (cause) => new KVError({ operation: "get", key, cause }),
				});
			});

			const getOrFail = Effect.fn("KV.getOrFail")(function* (
				key: string,
				options?: KVGetOptions,
			) {
				const value = yield* get(key, options);
				if (value === null) {
					return yield* Effect.fail(
						new Errors.NotFoundError({
							resource: "KV",
							key,
						}),
					);
				}
				return value;
			});

			const getWithMetadata = Effect.fn("KV.getWithMetadata")(function* <
				M = unknown,
			>(key: string, options?: KVGetOptions) {
				return yield* Effect.tryPromise({
					try: async () => {
						const result = await binding.getWithMetadata<M>(key, {
							type: "text",
							...(options?.cacheTtl !== undefined && {
								cacheTtl: options.cacheTtl,
							}),
						});
						return {
							value: result.value,
							metadata: result.metadata,
						} satisfies KVValueWithMetadata<string | null, M>;
					},
					catch: (cause) =>
						new KVError({
							operation: "getWithMetadata",
							key,
							cause,
						}),
				});
			});

			const put = Effect.fn("KV.put")(function* (
				key: string,
				value: string,
				options?: KVPutOptions,
			) {
				return yield* Effect.tryPromise({
					try: () => binding.put(key, value, options),
					catch: (cause) => new KVError({ operation: "put", key, cause }),
				});
			});

			const del = Effect.fn("KV.delete")(function* (key: string) {
				return yield* Effect.tryPromise({
					try: () => binding.delete(key),
					catch: (cause) => new KVError({ operation: "delete", key, cause }),
				});
			});

			const list = Effect.fn("KV.list")(function* (options?: KVListOptions) {
				return yield* Effect.tryPromise({
					try: () => binding.list(options),
					catch: (cause) => new KVError({ operation: "list", cause }),
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

	/**
	 * Create a Layer from a KV binding.
	 *
	 * This is the standard way to provide KV service to Effect programs.
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
	 *   yield* kv.put("key", "value")
	 * }).pipe(Effect.provide(layer))
	 * ```
	 */
	static layer = (binding: KVBinding) => Layer.effect(this, this.make(binding));

	/**
	 * Create schema-validated KV variant (JSON mode).
	 *
	 * Returns a factory with `make` and `layer` methods that automatically:
	 * - Encode values to JSON before storing
	 * - Decode JSON values after retrieval
	 * - Validate against the provided schema
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
	 * const userKV = KV.json(UserSchema)
	 * const layer = userKV.layer(env.USERS_KV)
	 *
	 * const program = Effect.gen(function*() {
	 *   const kv = yield* KV
	 *   // Fully typed - returns User | null
	 *   const user: User | null = yield* kv.get("user:123")
	 *   // Fully typed - accepts User
	 *   yield* kv.put("user:456", { id: "456", name: "Bob", email: "bob@x.com" })
	 * }).pipe(Effect.provide(layer))
	 * ```
	 */
	static json = <A>(schema: Schema.Schema<A>) => ({
		make: (binding: KVBinding) =>
			Effect.gen(function* () {
				const baseKV = yield* KV.make(binding);

				const get = Effect.fn("KV.json.get")(function* (
					key: string,
					options?: KVGetOptions,
				) {
					const rawValue = yield* baseKV.get(key, options);
					if (rawValue === null) {
						return null as A | null;
					}

					const parsed = yield* Effect.try({
						try: () => JSON.parse(rawValue),
						catch: (cause) =>
							new Errors.SchemaError({
								message: `Failed to parse JSON for key "${key}"`,
								cause: cause as Error,
							}),
					});

					return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
						Effect.mapError(
							(cause) =>
								new Errors.SchemaError({
									message: `Schema validation failed for key "${key}"`,
									cause: cause as Error,
								}),
						),
					);
				});

				const getOrFail = Effect.fn("KV.json.getOrFail")(function* (
					key: string,
					options?: KVGetOptions,
				) {
					const value = yield* get(key, options);
					if (value === null) {
						return yield* Effect.fail(
							new Errors.NotFoundError({
								resource: "KV",
								key,
							}),
						);
					}
					return value;
				});

				const getWithMetadata = Effect.fn("KV.json.getWithMetadata")(function* <
					M = unknown,
				>(key: string, options?: KVGetOptions) {
					const { value: rawValue, metadata } =
						yield* baseKV.getWithMetadata<M>(key, options);

					if (rawValue === null) {
						return {
							value: null as A | null,
							metadata,
						} satisfies KVValueWithMetadata<A | null, M>;
					}

					const parsed = yield* Effect.try({
						try: () => JSON.parse(rawValue),
						catch: (cause) =>
							new Errors.SchemaError({
								message: `Failed to parse JSON for key "${key}"`,
								cause: cause as Error,
							}),
					});

					const decoded: A = yield* Schema.decodeUnknownEffect(schema)(
						parsed,
					).pipe(
						Effect.mapError(
							(cause) =>
								new Errors.SchemaError({
									message: `Schema validation failed for key "${key}"`,
									cause: cause as Error,
								}),
						),
					);

					return {
						value: decoded,
						metadata,
					} satisfies KVValueWithMetadata<A, M>;
				});

				const put = Effect.fn("KV.json.put")(function* (
					key: string,
					value: A,
					options?: KVPutOptions,
				) {
					const encoded = yield* Schema.encodeEffect(schema)(value).pipe(
						Effect.mapError(
							(cause) =>
								new Errors.SchemaError({
									message: `Schema encoding failed for key "${key}"`,
									cause: cause as Error,
								}),
						),
					);

					const json = yield* Effect.try({
						try: () => JSON.stringify(encoded),
						catch: (cause) =>
							new Errors.SchemaError({
								message: `Failed to stringify JSON for key "${key}"`,
								cause: cause as Error,
							}),
					});

					return yield* baseKV.put(key, json, options);
				});

				// Return service with typed methods
				// Note: This object is structurally compatible with KV service,
				// but uses generic type A instead of string for values.
				return {
					get,
					getOrFail,
					getWithMetadata,
					put,
					delete: baseKV.delete,
					list: baseKV.list,
				};
			}),
		layer: (binding: KVBinding) =>
			Layer.effect(
				KV,
				// Type assertion is safe: we provide a KV-compatible service with
				// schema-validated types (A instead of string). The Layer system
				// handles this correctly at runtime since the shape is identical.
				KV.json(schema).make(binding) as unknown as ReturnType<typeof KV.make>,
			),
	});
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
				}),
			),
		idleTimeToLive: "5 minutes",
	},
) {}
