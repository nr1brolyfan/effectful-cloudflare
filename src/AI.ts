/**
 * @module AI
 *
 * Effect-wrapped Cloudflare Workers AI inference.
 *
 * Provides a fully typed, Effect-based interface to Workers AI with:
 * - `run` for untyped model inference
 * - `runSchema` for schema-validated model responses
 * - Streaming support via `options.stream`
 * - Typed errors (`AIError`)
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
 * Structural type for the Workers AI binding.
 *
 * A minimal subset of Cloudflare's `Ai` abstract class that only requires the
 * `run()` method. The full `Ai` class (which has additional methods like
 * `gateway()`, `models()`, `toMarkdown()`) is assignable to this interface.
 *
 * @example
 * ```ts
 * const binding: AIBinding = env.AI
 * const binding: AIBinding = Testing.memoryAI()
 * ```
 */
export interface AIBinding {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: AIRunOptions
  ): Promise<unknown>;
}

/** Re-export of Cloudflare's `AiOptions` from `@cloudflare/workers-types`. */
export type AIRunOptions = AiOptions;

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
  readonly message: string;
  readonly cause?: unknown;
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
    readonly run: (
      model: string,
      inputs: Record<string, unknown>,
      options?: AIRunOptions
    ) => Effect.Effect<unknown, AIError>;
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
    const run = Effect.fn("AI.run")(function* (
      model: string,
      inputs: Record<string, unknown>,
      options?: AIRunOptions
    ) {
      yield* Effect.logDebug("AI.run").pipe(Effect.annotateLogs({ model }));
      return yield* Effect.tryPromise({
        try: () => binding.run(model, inputs, options),
        catch: (cause) =>
          new AIError({
            model,
            operation: "run",
            message: `AI inference failed for model: ${model}`,
            cause,
          }),
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
      const rawResponse = yield* run(model, inputs, options);

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
