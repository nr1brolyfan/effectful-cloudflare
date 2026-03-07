import { Data } from "effect"

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
	): Promise<string | null>
	getWithMetadata<M = unknown>(
		key: string,
		options?: { type?: string; cacheTtl?: number },
	): Promise<{ value: string | null; metadata: M | null }>
	put(
		key: string,
		value: string,
		options?: {
			expiration?: number
			expirationTtl?: number
			metadata?: unknown
		},
	): Promise<void>
	delete(key: string): Promise<void>
	list(options?: {
		prefix?: string
		limit?: number
		cursor?: string
	}): Promise<{
		keys: ReadonlyArray<{
			name: string
			expiration?: number
			metadata?: unknown
		}>
		list_complete: boolean
		cursor?: string
	}>
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
	readonly operation: string
	readonly key?: string
	readonly cause: unknown
}> {}

// ── Options types ──────────────────────────────────────────────────────

/**
 * Options for KV get operations.
 *
 * @property cacheTtl - How long (in seconds) the value should be cached in edge locations
 */
export interface KVGetOptions {
	readonly cacheTtl?: number
}

/**
 * Options for KV put operations.
 *
 * @property expiration - Absolute Unix timestamp (in seconds) when the key should expire
 * @property expirationTtl - Relative time (in seconds) from now when the key should expire
 * @property metadata - Arbitrary metadata to associate with the key-value pair
 */
export interface KVPutOptions {
	readonly expiration?: number
	readonly expirationTtl?: number
	readonly metadata?: unknown
}

/**
 * Options for KV list operations.
 *
 * @property prefix - Only return keys that begin with this prefix
 * @property limit - Maximum number of keys to return (default: 1000, max: 1000)
 * @property cursor - Pagination cursor from a previous list operation
 */
export interface KVListOptions {
	readonly prefix?: string
	readonly limit?: number
	readonly cursor?: string
}

// ── Result types ───────────────────────────────────────────────────────

/**
 * Value with metadata returned from getWithMetadata.
 *
 * @template V - Type of the value
 * @template M - Type of the metadata
 */
export interface KVValueWithMetadata<V, M> {
	readonly value: V
	readonly metadata: M | null
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
		name: string
		expiration?: number
		metadata?: unknown
	}>
	readonly list_complete: boolean
	readonly cursor?: string
}
