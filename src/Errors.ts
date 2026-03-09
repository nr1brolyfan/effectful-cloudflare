/**
 * @module Errors
 *
 * Shared tagged error types used across all effectful-cloudflare service modules.
 *
 * Follows Effect v4 error patterns:
 * - `Data.TaggedError` for internal infrastructure errors (not serializable).
 * - `Schema.TaggedErrorClass` for domain errors (serializable, with schema).
 *
 * All service modules re-use these errors in their error channels alongside
 * their own module-specific error types.
 */

import { Data, Schema } from "effect";

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
  readonly service: string;
  readonly message: string;
}> {}

// ── Domain errors (schema-validated, serializable) ─────────────────────

/**
 * Schema decode/encode failed.
 *
 * Domain error for schema validation failures. This error is serializable
 * and can be sent over the wire (e.g., in HTTP API responses).
 *
 * @example
 * ```ts
 * new SchemaError({
 *   message: "Invalid user data",
 *   cause: Schema.Defect.of(parseError)
 * })
 * ```
 */
export class SchemaError extends Schema.TaggedErrorClass<SchemaError>()(
  "SchemaError",
  {
    message: Schema.String,
    cause: Schema.Defect,
  }
) {}

/**
 * Resource not found.
 *
 * Serializable domain error for missing resources. Includes `httpApiStatus: 404`
 * for HTTP API integration. Used by `getOrFail` methods across services.
 *
 * @example
 * ```ts
 * new NotFoundError({
 *   resource: "KV",
 *   key: "user:123"
 * })
 * ```
 */
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  {
    resource: Schema.String,
    key: Schema.String,
  },
  { httpApiStatus: 404 }
) {}
