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
