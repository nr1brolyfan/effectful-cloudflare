import { Effect, Layer, ServiceMap } from "effect"

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
		Layer.succeed(this, this.of(env))
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
			effect: Effect.Effect<void, never>,
		) => Effect.Effect<void>
		readonly passThroughOnException: () => Effect.Effect<void>
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
		ctx: ExecutionContext,
	) {
		return ExecutionCtx.of({
			waitUntil: (effect) =>
				Effect.sync(() => ctx.waitUntil(Effect.runPromise(effect))),
			passThroughOnException: () =>
				Effect.sync(() => ctx.passThroughOnException()),
		})
	})

	/**
	 * Create a layer from native Cloudflare ExecutionContext.
	 *
	 * @param ctx - Native Cloudflare ExecutionContext from fetch handler
	 * @returns Layer providing ExecutionCtx service
	 */
	static layer = (ctx: ExecutionContext) =>
		Layer.effect(this, this.make(ctx))
}
