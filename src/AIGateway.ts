/**
 * @module AIGateway
 *
 * Effect-wrapped Cloudflare AI Gateway proxy.
 *
 * AI Gateway provides multi-provider AI routing with logging, caching,
 * rate limiting, and observability. This module wraps the AI Gateway
 * binding with Effect-based error handling and tracing.
 *
 * Provides:
 * - `run` / `runBatch` for sending requests through the gateway
 * - `getLog` / `patchLog` for accessing and annotating request logs
 * - `getUrl` for retrieving the gateway endpoint URL
 * - Typed errors (`AIGatewayRequestError`, `AIGatewayResponseError`)
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { AIGateway } from "effectful-cloudflare/AIGateway"
 *
 * const program = Effect.gen(function*() {
 *   const gw = yield* AIGateway
 *   const response = yield* gw.run({
 *     provider: "openai",
 *     endpoint: "chat/completions",
 *     headers: { Authorization: "Bearer ..." },
 *     query: { model: "gpt-4", messages: [{ role: "user", content: "Hi" }] }
 *   })
 * }).pipe(Effect.provide(AIGateway.layer(env.AI_GATEWAY)))
 * ```
 */

import { Data, Effect, Layer, ServiceMap } from "effect";

// ── Binding types ──────────────────────────────────────────────────────

/** Re-export of Cloudflare's `AIGatewayUniversalRequest`. */
export type AIGatewayRequest = AIGatewayUniversalRequest;

/** Re-export of Cloudflare's `AiGatewayLog`. */
export type AIGatewayLog = AiGatewayLog;

/** Re-export of Cloudflare's `AiGatewayPatchLog`. */
export type AIGatewayPatchLog = globalThis.AiGatewayPatchLog;

/**
 * Re-export of Cloudflare's `AiGateway` abstract class from `@cloudflare/workers-types`.
 *
 * @example
 * ```ts
 * const binding: AIGatewayBinding = env.AI_GATEWAY
 * const binding: AIGatewayBinding = Testing.memoryAIGateway()
 * ```
 */
export type AIGatewayBinding = AiGateway;

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * Request to AI Gateway failed.
 *
 * Thrown when the gateway itself is unreachable or rejects the request
 * before it reaches the target AI provider.
 *
 * @example
 * ```ts
 * new AIGatewayRequestError({
 *   operation: "run",
 *   message: "Network error: gateway unreachable",
 *   cause: fetchError
 * })
 * ```
 */
export class AIGatewayRequestError extends Data.TaggedError(
  "AIGatewayRequestError"
)<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * AI Gateway returned an error response.
 *
 * Thrown when the gateway successfully processes the request but the
 * target AI provider returns an error (4xx/5xx status).
 *
 * @example
 * ```ts
 * new AIGatewayResponseError({
 *   operation: "run",
 *   message: "OpenAI API returned 429: Rate limit exceeded",
 *   status: 429,
 *   statusText: "Too Many Requests",
 *   body: { error: { message: "Rate limit exceeded" } }
 * })
 * ```
 */
export class AIGatewayResponseError extends Data.TaggedError(
  "AIGatewayResponseError"
)<{
  readonly operation: string;
  readonly message: string;
  readonly status: number;
  readonly statusText?: string;
  readonly body?: unknown;
}> {}

// ── Service ─────────────────────────────────────────────────────────────

/**
 * AI Gateway service for multi-provider AI routing.
 *
 * Provides methods to send requests through Cloudflare AI Gateway, which
 * acts as a unified proxy for multiple AI providers (OpenAI, Anthropic,
 * Workers AI, Bedrock, Google AI Studio, etc.).
 *
 * AI Gateway features:
 * - Unified API across providers
 * - Request/response logging
 * - Automatic caching
 * - Rate limiting
 * - Cost tracking
 * - Analytics
 *
 * All methods use `Effect.fn` for automatic tracing and return proper Effect types.
 *
 * @example
 * ```ts
 * import { AIGateway } from "effectful-cloudflare/AIGateway"
 * import { Effect } from "effect"
 *
 * const program = Effect.gen(function*() {
 *   const gateway = yield* AIGateway
 *
 *   // Send a request through the gateway
 *   const response = yield* gateway.run({
 *     provider: "openai",
 *     endpoint: "/v1/chat/completions",
 *     headers: { "Content-Type": "application/json" },
 *     query: {
 *       model: "gpt-4",
 *       messages: [{ role: "user", content: "Hello!" }]
 *     }
 *   })
 *
 *   const logId = response.headers.get("cf-aig-log-id")
 *   if (logId) {
 *     // Retrieve the log entry
 *     const log = yield* gateway.getLog(logId)
 *     console.log("Tokens used:", log.tokens)
 *     console.log("Cost:", log.cost)
 *
 *     // Attach feedback
 *     yield* gateway.patchLog(logId, { score: 5, metadata: { helpful: true } })
 *   }
 * }).pipe(Effect.provide(AIGateway.layer(env.AI_GATEWAY)))
 * ```
 */
export class AIGateway extends ServiceMap.Service<
  AIGateway,
  {
    readonly run: (
      request: AIGatewayRequest
    ) => Effect.Effect<
      Response,
      AIGatewayRequestError | AIGatewayResponseError
    >;
    readonly runBatch: (
      requests: readonly AIGatewayRequest[]
    ) => Effect.Effect<
      Response,
      AIGatewayRequestError | AIGatewayResponseError
    >;
    readonly getLog: (
      logId: string
    ) => Effect.Effect<AIGatewayLog, AIGatewayRequestError>;
    readonly patchLog: (
      logId: string,
      options: AIGatewayPatchLog
    ) => Effect.Effect<void, AIGatewayRequestError>;
    readonly getUrl: (
      provider?: string
    ) => Effect.Effect<string, AIGatewayRequestError>;
  }
>()("effectful-cloudflare/AIGateway") {
  /**
   * Create an AIGateway service instance from a binding.
   *
   * @param binding - The AI Gateway binding from Cloudflare Workers environment
   * @returns Effect that yields an AIGateway service instance
   *
   * @example
   * ```ts
   * const service = yield* AIGateway.make(env.AI_GATEWAY)
   * ```
   */
  static make = Effect.fn("AIGateway.make")(function* (
    binding: AIGatewayBinding
  ) {
    const run = Effect.fn("AIGateway.run")(function* (
      request: AIGatewayRequest
    ) {
      yield* Effect.logDebug("AIGateway.run");
      const response = yield* Effect.tryPromise({
        try: () => binding.run(request),
        catch: (cause) =>
          new AIGatewayRequestError({
            operation: "run",
            message: "Failed to send request to AI Gateway",
            cause,
          }),
      });

      // Check for error responses
      if (!response.ok) {
        const bodyText = yield* Effect.promise(() => response.text()).pipe(
          Effect.option
        );

        return yield* Effect.fail(
          new AIGatewayResponseError({
            operation: "run",
            message: `AI Gateway returned ${response.status}: ${response.statusText}`,
            status: response.status,
            statusText: response.statusText,
            body: bodyText._tag === "Some" ? bodyText.value : undefined,
          })
        );
      }

      return response;
    });

    const runBatch = Effect.fn("AIGateway.runBatch")(function* (
      requests: readonly AIGatewayRequest[]
    ) {
      yield* Effect.logDebug("AIGateway.runBatch").pipe(
        Effect.annotateLogs({ requestCount: requests.length })
      );
      const response = yield* Effect.tryPromise({
        try: () => binding.run([...requests]),
        catch: (cause) =>
          new AIGatewayRequestError({
            operation: "runBatch",
            message: "Failed to send batch request to AI Gateway",
            cause,
          }),
      });

      // Check for error responses
      if (!response.ok) {
        const bodyText = yield* Effect.promise(() => response.text()).pipe(
          Effect.option
        );

        return yield* Effect.fail(
          new AIGatewayResponseError({
            operation: "runBatch",
            message: `AI Gateway returned ${response.status}: ${response.statusText}`,
            status: response.status,
            statusText: response.statusText,
            body: bodyText._tag === "Some" ? bodyText.value : undefined,
          })
        );
      }

      return response;
    });

    const getLog = Effect.fn("AIGateway.getLog")(function* (logId: string) {
      yield* Effect.logDebug("AIGateway.getLog").pipe(
        Effect.annotateLogs({ logId })
      );
      return yield* Effect.tryPromise({
        try: () => binding.getLog(logId),
        catch: (cause) =>
          new AIGatewayRequestError({
            operation: "getLog",
            message: `Failed to retrieve log ${logId}`,
            cause,
          }),
      });
    });

    const patchLog = Effect.fn("AIGateway.patchLog")(function* (
      logId: string,
      options: AIGatewayPatchLog
    ) {
      yield* Effect.logDebug("AIGateway.patchLog").pipe(
        Effect.annotateLogs({ logId })
      );
      return yield* Effect.tryPromise({
        try: () => binding.patchLog(logId, options),
        catch: (cause) =>
          new AIGatewayRequestError({
            operation: "patchLog",
            message: `Failed to update log ${logId}`,
            cause,
          }),
      });
    });

    const getUrl = Effect.fn("AIGateway.getUrl")(function* (provider?: string) {
      yield* Effect.logDebug("AIGateway.getUrl").pipe(
        Effect.annotateLogs({ ...(provider !== undefined && { provider }) })
      );
      return yield* Effect.tryPromise({
        try: () => binding.getUrl(provider),
        catch: (cause) =>
          new AIGatewayRequestError({
            operation: "getUrl",
            message: `Failed to get gateway URL${provider ? ` for provider ${provider}` : ""}`,
            cause,
          }),
      });
    });

    return AIGateway.of({ run, runBatch, getLog, patchLog, getUrl });
  });

  /**
   * Create an AIGateway service layer.
   *
   * @param binding - The AI Gateway binding from Cloudflare Workers environment
   * @returns Layer that provides the AIGateway service
   *
   * @example
   * ```ts
   * const AIGatewayLive = AIGateway.layer(env.AI_GATEWAY)
   *
   * const program = Effect.gen(function*() {
   *   const gateway = yield* AIGateway
   *   // use gateway...
   * }).pipe(Effect.provide(AIGatewayLive))
   * ```
   */
  static layer = (binding: AIGatewayBinding) =>
    Layer.effect(this, this.make(binding));
}
