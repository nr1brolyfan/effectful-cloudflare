import { Data, Effect, Layer, ServiceMap } from "effect";

// ── Binding type ───────────────────────────────────────────────────────

/**
 * Minimal structural type for Workers AI binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It extracts only the methods
 * we need from the native Ai interface.
 *
 * Workers AI provides a single `run()` method that executes inference
 * on Cloudflare's AI models (LLMs, embeddings, image classification, etc.).
 *
 * @example
 * ```ts
 * // Use with native Cloudflare binding
 * const binding: AIBinding = env.AI
 *
 * // Or use with test mock
 * const binding: AIBinding = Testing.memoryAI()
 * ```
 */
export interface AIBinding {
  /**
   * Run inference on a Workers AI model.
   *
   * @param model - Model name (e.g., "@cf/meta/llama-3-8b-instruct")
   * @param inputs - Model-specific input data (varies by model type)
   * @param options - Optional configuration (stream, etc.)
   * @returns Promise resolving to model-specific output
   */
  run<T = unknown>(
    model: string,
    inputs: Record<string, unknown>,
    options?: AIRunOptions
  ): Promise<T>;
}

/**
 * Options for Workers AI run operation.
 */
export interface AIRunOptions {
  /**
   * Enable streaming response (for text generation models).
   * When true, returns a ReadableStream instead of the full response.
   */
  readonly stream?: boolean;
}

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * Workers AI operation failed.
 *
 * Module-specific error wrapping Cloudflare Workers AI exceptions.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new AIError({
 *   model: "@cf/meta/llama-3-8b-instruct",
 *   operation: "run",
 *   cause: nativeError
 * })
 * ```
 */
export class AIError extends Data.TaggedError("AIError")<{
  readonly model: string;
  readonly operation: string;
  readonly cause: unknown;
}> {}

/**
 * Model-specific error from Workers AI.
 *
 * Thrown when the AI model returns an error response (e.g., invalid input,
 * model capacity exceeded, unsupported features).
 *
 * @example
 * ```ts
 * new AIModelError({
 *   model: "@cf/meta/llama-3-8b-instruct",
 *   code: "invalid_input",
 *   message: "Input exceeds maximum token limit"
 * })
 * ```
 */
export class AIModelError extends Data.TaggedError("AIModelError")<{
  readonly model: string;
  readonly code: string;
  readonly message: string;
}> {}

// ── Service ─────────────────────────────────────────────────────────────

/**
 * Workers AI service for running inference models.
 *
 * Provides methods to run AI models (LLMs, embeddings, image classification, etc.)
 * directly in Cloudflare Workers. All methods use `Effect.fn` for automatic tracing
 * and return proper Effect types.
 *
 * @example
 * ```ts
 * import { AI } from "effectful-cloudflare/AI"
 * import { Effect } from "effect"
 *
 * const program = Effect.gen(function*() {
 *   const ai = yield* AI
 *
 *   // Run text generation
 *   const response = yield* ai.run<{ response: string }>(
 *     "@cf/meta/llama-3-8b-instruct",
 *     { prompt: "What is the capital of France?" }
 *   )
 *
 *   console.log(response.response)
 * }).pipe(Effect.provide(AI.layer(env.AI)))
 * ```
 */
export class AI extends ServiceMap.Service<
  AI,
  {
    readonly run: <T = unknown>(
      model: string,
      inputs: Record<string, unknown>,
      options?: AIRunOptions
    ) => Effect.Effect<T, AIError>;
  }
>()("effectful-cloudflare/AI") {
  /**
   * Create an AI service instance from a binding.
   *
   * @param binding - The Workers AI binding from Cloudflare Workers environment
   * @returns Effect that yields an AI service instance
   *
   * @example
   * ```ts
   * const service = yield* AI.make(env.AI)
   * ```
   */
  static make = Effect.fn("AI.make")(function* (binding: AIBinding) {
    const run = Effect.fn("AI.run")(function* <T = unknown>(
      model: string,
      inputs: Record<string, unknown>,
      options?: AIRunOptions
    ) {
      return yield* Effect.tryPromise({
        try: () => binding.run<T>(model, inputs, options),
        catch: (cause) => new AIError({ model, operation: "run", cause }),
      });
    });

    return AI.of({ run });
  });

  /**
   * Create an AI service layer.
   *
   * @param binding - The Workers AI binding from Cloudflare Workers environment
   * @returns Layer that provides the AI service
   *
   * @example
   * ```ts
   * const AILive = AI.layer(env.AI)
   *
   * const program = Effect.gen(function*() {
   *   const ai = yield* AI
   *   // use ai...
   * }).pipe(Effect.provide(AILive))
   * ```
   */
  static layer = (binding: AIBinding) => Layer.effect(this, this.make(binding));
}
