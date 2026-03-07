import { Data, Schema } from "effect"

// ── Internal errors (no schema, not serializable) ──────────────────────

/**
 * Binding not available at runtime.
 *
 * Used when a Cloudflare binding is not available in the worker environment.
 * This is an internal infrastructure error and is not serializable.
 *
 * @example
 * ```ts
 * new BindingError({
 *   service: "KV",
 *   message: "MY_KV binding not found in worker environment"
 * })
 * ```
 */
export class BindingError extends Data.TaggedError("BindingError")<{
	readonly service: string
	readonly message: string
}> {}

/**
 * Wraps unexpected errors from Cloudflare APIs.
 *
 * Used to wrap native Cloudflare exceptions that occur during binding operations.
 * This is an internal error with an `unknown` cause field.
 *
 * @example
 * ```ts
 * new TransportError({
 *   service: "R2",
 *   operation: "put",
 *   cause: nativeError
 * })
 * ```
 */
export class TransportError extends Data.TaggedError("TransportError")<{
	readonly service: string
	readonly operation: string
	readonly cause: unknown
}> {}
