/**
 * @module AI
 *
 * Effect-wrapped Cloudflare Workers AI inference.
 *
 * Provides a fully typed, Effect-based interface to Workers AI with:
 * - `run` for untyped model inference
 * - `runSchema` for schema-validated model responses
 * - Streaming support via `options.stream`
 * - Typed errors (`AIError`, `AIModelError`)
 * - Automatic tracing spans via `Effect.fn`
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { AI } from "effectful-cloudflare/AI"
 *
 * const program = Effect.gen(function*() {
 *   const ai = yield* AI
 *   const result = yield* ai.run("@cf/meta/llama-3-8b-instruct", {
 *     messages: [{ role: "user", content: "Hello!" }]
 *   })
 * }).pipe(Effect.provide(AI.layer(env.AI)))
 * ```
 */

import { Data, Effect, Layer, ServiceMap } from "effect";
import * as Schema from "effect/Schema";
import * as Errors from "./Errors.js";

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

// ── Schema constraint ──────────────────────────────────────────────────

/** A Schema that requires no external services for encoding/decoding. */
type PureSchema<A> = Schema.Schema<A> & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

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
 * import { Effect, Schema } from "effect"
 *
 * // Basic untyped usage
 * const program = Effect.gen(function*() {
 *   const ai = yield* AI
 *
 *   // Run text generation (returns unknown)
 *   const response = yield* ai.run<{ response: string }>(
 *     "@cf/meta/llama-3-8b-instruct",
 *     { prompt: "What is the capital of France?" }
 *   )
 *
 *   console.log(response.response)
 * }).pipe(Effect.provide(AI.layer(env.AI)))
 *
 * // Schema-validated usage
 * const ResponseSchema = Schema.Struct({ response: Schema.String })
 * const program2 = Effect.gen(function*() {
 *   const ai = yield* AI
 *
 *   // Run with schema validation (fully typed)
 *   const response = yield* ai.runSchema(
 *     "@cf/meta/llama-3-8b-instruct",
 *     ResponseSchema,
 *     { prompt: "What is the capital of France?" }
 *   )
 *
 *   console.log(response.response) // typed as string
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
    readonly runSchema: <A>(
      model: string,
      schema: PureSchema<A>,
      inputs: Record<string, unknown>,
      options?: AIRunOptions
    ) => Effect.Effect<A, AIError | Errors.SchemaError>;
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
      yield* Effect.logDebug("AI.run").pipe(Effect.annotateLogs({ model }));
      return yield* Effect.tryPromise({
        try: () => binding.run<T>(model, inputs, options),
        catch: (cause) => new AIError({ model, operation: "run", cause }),
      });
    });

    const runSchema = Effect.fn("AI.runSchema")(function* <A>(
      model: string,
      responseSchema: PureSchema<A>,
      inputs: Record<string, unknown>,
      options?: AIRunOptions
    ) {
      yield* Effect.logDebug("AI.runSchema").pipe(
        Effect.annotateLogs({ model })
      );
      // First run the model to get raw response
      const rawResponse = yield* run<unknown>(model, inputs, options);

      // Then decode the response using the schema
      return yield* Schema.decodeUnknownEffect(responseSchema)(
        rawResponse
      ).pipe(
        Effect.mapError(
          (cause) =>
            new Errors.SchemaError({
              message: "Failed to decode AI response",
              cause: cause as Error,
            })
        )
      );
    });

    return AI.of({ run, runSchema });
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
