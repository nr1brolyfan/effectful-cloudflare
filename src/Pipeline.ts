/**
 * @module Pipeline
 *
 * Effect-wrapped Cloudflare Pipelines (streaming ETL to R2).
 *
 * Cloudflare Pipelines allow ingesting structured data records that are
 * batched, transformed, and written to an R2 bucket. This module wraps
 * the Pipeline binding with Effect-based error handling.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Pipeline } from "effectful-cloudflare/Pipeline"
 *
 * const program = Effect.gen(function*() {
 *   const pipeline = yield* Pipeline
 *   yield* pipeline.send([
 *     { event: "page_view", url: "/home", ts: Date.now() },
 *     { event: "click", target: "signup", ts: Date.now() }
 *   ])
 * }).pipe(Effect.provide(Pipeline.layer(env.MY_PIPELINE)))
 * ```
 */

import { Data, Effect, Layer, ServiceMap } from "effect";

// ── Binding type ───────────────────────────────────────────────────────

/**
 * Minimal structural type for Cloudflare Pipelines binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It maps to the Cloudflare Pipelines
 * API for streaming ETL to R2.
 *
 * Pipelines provide a simple way to send structured event data to R2 for
 * analytics and data warehousing. Events are batched and transformed via SQL
 * before being written to R2 in Iceberg table format.
 *
 * @example
 * ```ts
 * // Use with native Cloudflare binding
 * const binding: PipelineBinding = env.MY_PIPELINE
 *
 * // Or use with test mock
 * const binding: PipelineBinding = Testing.memoryPipeline()
 * ```
 */
export interface PipelineBinding {
  /**
   * Send a single event or batch of events to the pipeline.
   *
   * @param data - Single event object or array of event objects
   * @returns Promise<void> - No confirmation data returned
   *
   * @remarks
   * - Accepts single object or array of objects
   * - Returns void (no confirmation data)
   * - Throws on network/validation errors
   * - Max 1 MB per request, 5 MB/s per stream
   *
   * @example
   * ```ts
   * // Single event
   * await binding.send({ user_id: "123", event_type: "purchase", amount: 50 })
   *
   * // Batch events
   * await binding.send([
   *   { user_id: "123", event_type: "view" },
   *   { user_id: "456", event_type: "purchase", amount: 100 }
   * ])
   * ```
   */
  send(data: object | readonly object[]): Promise<void>;
}

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * Pipeline operation failed.
 *
 * Module-specific error wrapping Cloudflare Pipelines exceptions.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new PipelineError({
 *   operation: "send",
 *   message: "Failed to send events to pipeline",
 *   cause: nativeError
 * })
 * ```
 */
export class PipelineError extends Data.TaggedError("PipelineError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Service ─────────────────────────────────────────────────────────────

/**
 * Pipeline service for streaming ETL to R2.
 *
 * Provides methods to send structured events to Cloudflare Pipelines, which
 * batch, transform via SQL, and write to R2 in Iceberg format. All methods
 * use `Effect.fn` for automatic tracing and return proper Effect types.
 *
 * @example
 * ```ts
 * import { Pipeline } from "effectful-cloudflare/Pipeline"
 * import { Effect } from "effect"
 *
 * // Send single event
 * const program1 = Effect.gen(function*() {
 *   const pipeline = yield* Pipeline
 *
 *   yield* pipeline.send({
 *     user_id: "12345",
 *     event_type: "purchase",
 *     product_id: "widget-001",
 *     amount: 29.99,
 *     timestamp: Date.now()
 *   })
 * }).pipe(Effect.provide(Pipeline.layer(env.MY_PIPELINE)))
 *
 * // Send batch of events
 * const program2 = Effect.gen(function*() {
 *   const pipeline = yield* Pipeline
 *
 *   yield* pipeline.sendBatch([
 *     { user_id: "user1", event_type: "view", timestamp: Date.now() },
 *     { user_id: "user2", event_type: "purchase", amount: 50, timestamp: Date.now() }
 *   ])
 * }).pipe(Effect.provide(Pipeline.layer(env.MY_PIPELINE)))
 *
 * // Fire-and-forget pattern with ExecutionCtx
 * const program3 = Effect.gen(function*() {
 *   const pipeline = yield* Pipeline
 *   const ctx = yield* ExecutionCtx
 *
 *   const event = { user_id: "123", event_type: "click" }
 *
 *   // Don't block response on pipeline send
 *   yield* ctx.waitUntil(pipeline.send(event))
 *
 *   return new Response("OK")
 * })
 * ```
 */
export class Pipeline extends ServiceMap.Service<
  Pipeline,
  {
    readonly send: (
      data: object | readonly object[]
    ) => Effect.Effect<void, PipelineError>;
    readonly sendBatch: (
      events: readonly object[]
    ) => Effect.Effect<void, PipelineError>;
  }
>()("effectful-cloudflare/Pipeline") {
  /**
   * Create a Pipeline service instance from a binding.
   *
   * All pipeline operations are wrapped in Effect with proper error handling
   * and tracing via `Effect.fn`.
   *
   * @param binding - The Pipeline binding from Cloudflare Workers environment
   * @returns Effect that yields a Pipeline service instance
   *
   * @example
   * ```ts
   * const service = yield* Pipeline.make(env.MY_PIPELINE)
   * ```
   */
  static make = Effect.fn("Pipeline.make")(function* (
    binding: PipelineBinding
  ) {
    // send - Send single event or batch to pipeline
    const send = (data: object | readonly object[]) =>
      Effect.tryPromise({
        try: () => binding.send(data),
        catch: (cause) =>
          new PipelineError({
            operation: "send",
            message: "Failed to send events to pipeline",
            cause,
          }),
      }).pipe(Effect.withSpan("Pipeline.send"));

    // sendBatch - Convenience method for sending array of events
    const sendBatch = (events: readonly object[]) =>
      Effect.tryPromise({
        try: () => binding.send(events),
        catch: (cause) =>
          new PipelineError({
            operation: "sendBatch",
            message: `Failed to send batch of ${events.length} events to pipeline`,
            cause,
          }),
      }).pipe(Effect.withSpan("Pipeline.sendBatch"));

    return Pipeline.of({
      send,
      sendBatch,
    });
  });

  /**
   * Create a Pipeline service layer.
   *
   * @param binding - The Pipeline binding from Cloudflare Workers environment
   * @returns Layer that provides the Pipeline service
   *
   * @example
   * ```ts
   * const PipelineLive = Pipeline.layer(env.MY_PIPELINE)
   *
   * const program = Effect.gen(function*() {
   *   const pipeline = yield* Pipeline
   *   // use pipeline...
   * }).pipe(Effect.provide(PipelineLive))
   * ```
   */
  static layer = (binding: PipelineBinding) =>
    Layer.effect(this, this.make(binding));
}
