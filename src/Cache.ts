import { Data } from "effect";

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
