/**
 * @module Worker
 *
 * Cloudflare Worker entrypoint utilities.
 *
 * Bridges Cloudflare Worker lifecycle events (`fetch`, `scheduled`, `queue`)
 * to the Effect runtime. Provides:
 * - `WorkerEnv` service — raw worker environment bindings as a service.
 * - `ExecutionCtx` service — Effect-wrapped `waitUntil` and `passThroughOnException`.
 * - `serve()` — create an `ExportedHandler.fetch` from an Effect program.
 * - `onScheduled()` — create an `ExportedHandler.scheduled` handler.
 * - `onQueue()` — create an `ExportedHandler.queue` handler.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Worker } from "effectful-cloudflare/Worker"
 * import type { Env } from "./alchemy.run" // or wrangler-generated types
 *
 * export default Worker.serve(
 *   (request) => Effect.succeed(new Response("Hello!")),
 *   (env: Env, ctx) => Layer.mergeAll(
 *     KV.layer(env.MY_KV),         // env.MY_KV is already typed!
 *     ExecutionCtx.layer(ctx),
 *   )
 * )
 * ```
 */

import { Effect, Layer, ServiceMap } from "effect";

// ── WorkerEnv Service ──────────────────────────────────────────────────

/**
 * WorkerEnv service — provides raw Cloudflare worker environment bindings.
 *
 * This service exposes the worker's `env` object (containing all bindings like KV, R2, D1, etc.)
 * as an Effect service. It's the foundation for all other binding-specific services.
 *
 * @example
 * ```ts
 * // Create layer from worker env
 * const envLayer = WorkerEnv.layer(env)
 *
 * // Use in Effect program
 * const program = Effect.gen(function*() {
 *   const env = yield* WorkerEnv
 *   const kvBinding = env.MY_KV
 *   return kvBinding
 * })
 * ```
 */
export class WorkerEnv extends ServiceMap.Service<
  WorkerEnv,
  Record<string, unknown>
>()("effectful-cloudflare/WorkerEnv") {
  /**
   * Create a layer from the worker environment object.
   *
   * @param env - The worker environment object from the fetch handler
   * @returns Layer providing WorkerEnv service
   */
  static layer = (env: Record<string, unknown>) =>
    Layer.succeed(this, this.of(env));
}

// ── ExecutionCtx Service ───────────────────────────────────────────────

/**
 * ExecutionCtx service — provides Effect-wrapped Cloudflare ExecutionContext.
 *
 * This service wraps the Cloudflare `ExecutionContext` API, allowing you to:
 * - Schedule work to continue after response is returned (waitUntil)
 * - Enable pass-through on exception for graceful degradation
 *
 * Both operations are wrapped as Effect programs for composability.
 *
 * @example
 * ```ts
 * // Create layer from execution context
 * const ctxLayer = ExecutionCtx.layer(ctx)
 *
 * // Use in Effect program
 * const program = Effect.gen(function*() {
 *   const execCtx = yield* ExecutionCtx
 *
 *   // Schedule background work
 *   yield* execCtx.waitUntil(
 *     Effect.log("Background task").pipe(Effect.delay("1 second"))
 *   )
 *
 *   // Enable pass-through on exception
 *   yield* execCtx.passThroughOnException()
 * })
 * ```
 */
export class ExecutionCtx extends ServiceMap.Service<
  ExecutionCtx,
  {
    readonly waitUntil: (
      effect: Effect.Effect<void, never>
    ) => Effect.Effect<void>;
    readonly passThroughOnException: () => Effect.Effect<void>;
  }
>()("effectful-cloudflare/ExecutionCtx") {
  /**
   * Create ExecutionCtx service from native Cloudflare ExecutionContext.
   *
   * This static method wraps the native `ExecutionContext` methods in Effect programs.
   * Uses `Effect.fn` for automatic tracing.
   *
   * @param ctx - Native Cloudflare ExecutionContext from fetch handler
   * @returns Effect that yields the ExecutionCtx service
   */
  static make = Effect.fn("ExecutionCtx.make")(function* (
    ctx: ExecutionContext
  ) {
    return ExecutionCtx.of({
      waitUntil: (effect) =>
        Effect.sync(() => ctx.waitUntil(Effect.runPromise(effect))),
      passThroughOnException: () =>
        Effect.sync(() => ctx.passThroughOnException()),
    });
  });

  /**
   * Create a layer from native Cloudflare ExecutionContext.
   *
   * @param ctx - Native Cloudflare ExecutionContext from fetch handler
   * @returns Layer providing ExecutionCtx service
   */
  static layer = (ctx: ExecutionContext) => Layer.effect(this, this.make(ctx));
}

// ── Worker Entrypoint Functions ────────────────────────────────────────

/**
 * Create a Cloudflare Worker fetch handler from an Effect program.
 *
 * This function bridges the Cloudflare Workers runtime with Effect by:
 * - Accepting an Effect-based request handler
 * - Creating layers from the worker environment and execution context
 * - Running the Effect program and returning the Response
 * - Catching all errors and returning a 500 response on unhandled failures
 *
 * @param handler - Effect program that receives a Request and returns a Response
 * @param layers - Function that creates Effect layers from worker env and ExecutionContext
 * @returns ExportedHandler with fetch method
 *
 * @example
 * ```ts
 * import { Effect, Layer } from "effect"
 * import { Worker, KV } from "effectful-cloudflare"
 * import type { Env } from "./alchemy.run" // or wrangler-generated types
 *
 * export default Worker.serve(
 *   (request) => Effect.gen(function*() {
 *     const kv = yield* KV
 *     const value = yield* kv.get("hello")
 *     return new Response(value ?? "not found")
 *   }),
 *   (env: Env, ctx) => Layer.mergeAll(
 *     KV.layer(env.MY_KV),         // env.MY_KV is already typed!
 *     Worker.ExecutionCtx.layer(ctx),
 *   )
 * )
 * ```
 */
export const serve = <Env extends object, E, R>(
  handler: (request: Request) => Effect.Effect<Response, E, R>,
  layers: (env: Env, ctx: ExecutionContext) => Layer.Layer<R>
): ExportedHandler<Env> => ({
  fetch: (request, env, ctx) => {
    const layer = layers(env as Env, ctx);
    return Effect.runPromise(
      handler(request).pipe(
        Effect.provide(layer),
        Effect.catchCause(() =>
          Effect.succeed(
            new Response(JSON.stringify({ error: "Internal Server Error" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            })
          )
        )
      )
    );
  },
});

/**
 * Create a Cloudflare Worker scheduled handler from an Effect program.
 *
 * This function bridges the Cloudflare Workers cron trigger with Effect by:
 * - Accepting an Effect-based scheduled event handler
 * - Creating layers from the worker environment and execution context
 * - Running the Effect program when the cron trigger fires
 *
 * @param handler - Effect program that receives a ScheduledController and performs work
 * @param layers - Function that creates Effect layers from worker env and ExecutionContext
 * @returns Partial ExportedHandler with scheduled method
 *
 * @example
 * ```ts
 * import { Effect, Layer } from "effect"
 * import { Worker, KV } from "effectful-cloudflare"
 * import type { Env } from "./alchemy.run"
 *
 * export const scheduled = Worker.onScheduled(
 *   (controller) => Effect.gen(function*() {
 *     const kv = yield* KV
 *     yield* kv.put("last-run", new Date().toISOString())
 *     yield* Effect.log(`Scheduled at ${controller.scheduledTime}`)
 *   }),
 *   (env: Env, ctx) => Layer.mergeAll(
 *     KV.layer(env.MY_KV),         // env.MY_KV is already typed!
 *     Worker.ExecutionCtx.layer(ctx),
 *   )
 * )
 * ```
 */
export const onScheduled = <Env extends object, E, R>(
  handler: (controller: ScheduledController) => Effect.Effect<void, E, R>,
  layers: (env: Env, ctx: ExecutionContext) => Layer.Layer<R>
): Pick<ExportedHandler<Env>, "scheduled"> => ({
  scheduled: async (controller, env, ctx) => {
    const layer = layers(env as Env, ctx);
    await Effect.runPromise(handler(controller).pipe(Effect.provide(layer)));
  },
});

/**
 * Create a Cloudflare Worker queue handler from an Effect program.
 *
 * This function bridges the Cloudflare Queue consumer with Effect by:
 * - Accepting an Effect-based message batch handler
 * - Creating layers from the worker environment and execution context
 * - Running the Effect program when a batch of messages is received
 *
 * @param handler - Effect program that receives a MessageBatch and processes messages
 * @param layers - Function that creates Effect layers from worker env and ExecutionContext
 * @returns Partial ExportedHandler with queue method
 *
 * @example
 * ```ts
 * import { Effect, Layer } from "effect"
 * import { Worker, KV } from "effectful-cloudflare"
 * import type { Env } from "./alchemy.run"
 *
 * export const queue = Worker.onQueue(
 *   (batch) => Effect.gen(function*() {
 *     const kv = yield* KV
 *     for (const message of batch.messages) {
 *       yield* kv.put(message.id, JSON.stringify(message.body))
 *       yield* Effect.log(`Processed message ${message.id}`)
 *     }
 *   }),
 *   (env: Env, ctx) => Layer.mergeAll(
 *     KV.layer(env.MY_KV),         // env.MY_KV is already typed!
 *     Worker.ExecutionCtx.layer(ctx),
 *   )
 * )
 * ```
 */
export const onQueue = <Env extends object, T, E, R>(
  handler: (batch: MessageBatch<T>) => Effect.Effect<void, E, R>,
  layers: (env: Env, ctx: ExecutionContext) => Layer.Layer<R>
): Pick<ExportedHandler<Env>, "queue"> => ({
  queue: async (batch, env, ctx) => {
    const layer = layers(env as Env, ctx);
    await Effect.runPromise(
      handler(batch as MessageBatch<T>).pipe(Effect.provide(layer))
    );
  },
});
