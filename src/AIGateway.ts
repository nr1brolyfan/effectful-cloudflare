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

/**
 * Request type for AI Gateway universal API.
 *
 * Represents a request to be sent through AI Gateway to a specific provider.
 * The gateway handles routing, logging, caching, and rate limiting.
 *
 * @example
 * ```ts
 * const request: AIGatewayRequest = {
 *   provider: "openai",
 *   endpoint: "/v1/chat/completions",
 *   headers: { "Content-Type": "application/json" },
 *   query: {
 *     model: "gpt-4",
 *     messages: [{ role: "user", content: "Hello!" }]
 *   }
 * }
 * ```
 */
export interface AIGatewayRequest {
  /**
   * API endpoint path (e.g., "/v1/chat/completions")
   */
  readonly endpoint: string;
  /**
   * Optional HTTP headers to include in the request
   */
  readonly headers?: Record<string, string>;
  /**
   * AI provider to route the request to.
   * Supported: "openai", "anthropic", "workers-ai", "bedrock", "google-ai-studio", etc.
   */
  readonly provider: string;
  /**
   * Request body/query data (provider-specific format)
   */
  readonly query: unknown;
}

/**
 * AI Gateway log entry.
 *
 * Contains metadata about a request that was proxied through AI Gateway,
 * including request/response data, usage metrics, and cost information.
 */
export interface AIGatewayLog {
  /**
   * Whether the response was served from cache
   */
  readonly cached?: boolean;
  /**
   * Estimated cost in USD
   */
  readonly cost?: number;
  /**
   * ISO 8601 timestamp when the request was created
   */
  readonly created_at: string;
  /**
   * Unique log ID returned in `cf-aig-log-id` response header
   */
  readonly id: string;
  /**
   * Custom metadata attached to the log
   */
  readonly metadata?: Record<string, unknown>;
  /**
   * Model name (e.g., "gpt-4", "claude-3-opus")
   */
  readonly model: string;
  /**
   * Provider name (e.g., "openai", "anthropic")
   */
  readonly provider: string;
  /**
   * Request data sent to the provider
   */
  readonly request: {
    readonly messages: readonly {
      readonly role: string;
      readonly content: string;
    }[];
    readonly max_tokens?: number;
    readonly temperature?: number;
    readonly top_p?: number;
    readonly stream?: boolean;
    readonly tools?: readonly unknown[];
    readonly [key: string]: unknown;
  };
  /**
   * Response data received from the provider (if request succeeded)
   */
  readonly response?: {
    readonly message?: {
      readonly role: string;
      readonly content: string;
    };
    readonly usage?: {
      readonly prompt_tokens: number;
      readonly completion_tokens: number;
      readonly total_tokens: number;
    };
    readonly [key: string]: unknown;
  };
  /**
   * HTTP status code from provider response
   */
  readonly status_code?: number;
  /**
   * Total tokens used (prompt + completion)
   */
  readonly tokens?: number;
}

/**
 * Minimal structural type for Cloudflare AI Gateway binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It extracts only the methods
 * we need from the native AiGateway interface.
 *
 * AI Gateway is a unified proxy for multiple AI providers (OpenAI, Anthropic,
 * Workers AI, etc.) with built-in logging, caching, rate limiting, and cost tracking.
 *
 * @example
 * ```ts
 * // Use with native Cloudflare binding
 * const binding: AIGatewayBinding = env.AI_GATEWAY
 *
 * // Or use with test mock
 * const binding: AIGatewayBinding = Testing.memoryAIGateway()
 * ```
 */
export interface AIGatewayBinding {
  /**
   * Retrieve a log entry by its ID.
   *
   * Log IDs are returned in the `cf-aig-log-id` response header from `run()`.
   *
   * @param logId - The log ID to retrieve
   * @returns Promise resolving to the log entry
   */
  getLog(logId: string): Promise<AIGatewayLog>;
  /**
   * Get the AI Gateway URL for a specific provider.
   *
   * @param provider - Optional provider name
   * @returns Promise resolving to the gateway URL
   */
  getUrl(provider?: string): Promise<string>;
  /**
   * Update a log entry with custom metadata or feedback score.
   *
   * @param logId - The log ID to update
   * @param options - Metadata or score to attach
   * @returns Promise resolving when the update completes
   */
  patchLog(
    logId: string,
    options: { metadata?: Record<string, unknown>; score?: number }
  ): Promise<void>;
  /**
   * Send a request or batch of requests through AI Gateway.
   *
   * Supports both single requests and batched requests.
   *
   * @param requestOrRequests - Single request or array of requests to send
   * @returns Promise resolving to the provider's HTTP response
   */
  run(
    requestOrRequests: AIGatewayRequest | readonly AIGatewayRequest[]
  ): Promise<Response>;
}

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
      options: { metadata?: Record<string, unknown>; score?: number }
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
        try: () => binding.run(requests),
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
      options: { metadata?: Record<string, unknown>; score?: number }
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
