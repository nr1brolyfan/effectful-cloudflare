import { Data, Effect, Layer, ServiceMap } from "effect";
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
export type CacheBinding = {
	match(
		request: Request | string,
		options?: CacheQueryOptions,
	): Promise<Response | undefined>;
	put(request: Request | string, response: Response): Promise<void>;
	delete(
		request: Request | string,
		options?: CacheQueryOptions,
	): Promise<boolean>;
};

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
			options?: CacheQueryOptions,
		) => Effect.Effect<Response | null, CacheError>;
		readonly matchOrFail: (
			request: Request | string,
			options?: CacheQueryOptions,
		) => Effect.Effect<Response, CacheError | Errors.NotFoundError>;
		readonly put: (
			request: Request | string,
			response: Response,
		) => Effect.Effect<void, CacheError>;
		readonly delete: (
			request: Request | string,
			options?: CacheQueryOptions,
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
				options?: CacheQueryOptions,
			) {
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
				options?: CacheQueryOptions,
			) {
				const response = yield* match(request, options);
				if (response === null) {
					const url =
						typeof request === "string" ? request : request.url;
					return yield* Effect.fail(
						new Errors.NotFoundError({
							resource: "Cache",
							key: url,
						}),
					);
				}
				return response;
			});

			const put = Effect.fn("Cache.put")(function* (
				request: Request | string,
				response: Response,
			) {
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
				options?: CacheQueryOptions,
			) {
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
}
