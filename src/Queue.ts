/**
 * @module Queue
 *
 * Effect-wrapped Cloudflare Queues (producer and consumer).
 *
 * Provides a fully typed, Effect-based interface to Cloudflare Queues with:
 * - `QueueProducer` service for sending messages
 * - Schema-validated producer via optional schema parameter
 * - Consumer handler pattern with auto-ack/retry
 * - Batch send support
 * - Multi-queue support via `QueueProducerMap` (LayerMap)
 * - Automatic tracing spans via `Effect.fn`
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { QueueProducer } from "effectful-cloudflare/Queue"
 *
 * const program = Effect.gen(function*() {
 *   const queue = yield* QueueProducer
 *   yield* queue.send({ type: "user.created", userId: "123" })
 * }).pipe(Effect.provide(QueueProducer.layer(env.MY_QUEUE)))
 * ```
 */

import { Data, Effect, Layer, LayerMap, Schema, ServiceMap } from "effect";
import * as Errors from "./Errors.js";
import { WorkerEnv } from "./Worker.js";

// ── Binding type ───────────────────────────────────────────────────────

/**
 * Minimal structural type for Cloudflare Queue binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It extracts only the methods
 * we need from the native Queue interface.
 *
 * @example
 * ```ts
 * // Use with native Cloudflare binding
 * const binding: QueueBinding = env.MY_QUEUE
 *
 * // Or use with test mock
 * const binding: QueueBinding = Testing.memoryQueue()
 * ```
 */
/** Content type for queue messages. Matches Cloudflare's `QueueContentType`. */
export type QueueContentType = "bytes" | "json" | "text" | "v8";

export interface QueueBinding<T = unknown> {
  send(
    message: T,
    options?: { contentType?: QueueContentType; delaySeconds?: number }
  ): Promise<void>;
  sendBatch(
    messages: Iterable<{
      body: T;
      contentType?: QueueContentType;
      delaySeconds?: number;
    }>
  ): Promise<void>;
}

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * General queue operation failed.
 *
 * Module-specific error wrapping Cloudflare Queue exceptions.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new QueueError({
 *   operation: "send",
 *   message: "Failed to send message to queue",
 *   cause: nativeError
 * })
 * ```
 */
export class QueueError extends Data.TaggedError("QueueError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Queue send or sendBatch operation failed.
 *
 * Specific error for message sending failures.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new QueueSendError({
 *   operation: "send",
 *   messageCount: 1,
 *   cause: nativeError
 * })
 * ```
 */
export class QueueSendError extends Data.TaggedError("QueueSendError")<{
  readonly operation: "send" | "sendBatch";
  readonly messageCount: number;
  readonly cause: unknown;
}> {}

/**
 * Queue consumer handler failed.
 *
 * Error thrown when the consumer handler encounters an error processing messages.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new QueueConsumerError({
 *   batchSize: 10,
 *   message: "Failed to process message batch",
 *   cause: handlerError
 * })
 * ```
 */
export class QueueConsumerError extends Data.TaggedError("QueueConsumerError")<{
  readonly batchSize: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Options & Result types ──────────────────────────────────────────────

/**
 * Options for sending a single message to the queue.
 *
 * @example
 * ```ts
 * const options: QueueSendOptions = {
 *   contentType: "application/json",
 *   delaySeconds: 60
 * }
 * ```
 */
export interface QueueSendOptions {
  /**
   * Content type of the message. Determines how the message body is serialized.
   * @default "json"
   */
  readonly contentType?: QueueContentType;

  /**
   * Delay in seconds before the message becomes visible.
   * Maximum value is 43200 (12 hours).
   */
  readonly delaySeconds?: number;
}

/**
 * Single message in a batch send operation.
 *
 * @example
 * ```ts
 * const message: QueueBatchMessage<string> = {
 *   body: "Hello, Queue!",
 *   contentType: "text/plain",
 *   delaySeconds: 30
 * }
 * ```
 */
export interface QueueBatchMessage<T> {
  /**
   * Message body.
   */
  readonly body: T;

  /**
   * Content type of the message. Determines how the message body is serialized.
   * @default "json"
   */
  readonly contentType?: QueueContentType;

  /**
   * Delay in seconds before the message becomes visible.
   * Maximum value is 43200 (12 hours).
   */
  readonly delaySeconds?: number;
}

// ── QueueProducer service ───────────────────────────────────────────────

/**
 * Queue producer service for sending messages.
 *
 * The QueueProducer service provides a typed Effect-based API for:
 * - Sending single messages to a Cloudflare Queue
 * - Batch sending multiple messages
 * - Schema-validated JSON message encoding
 *
 * @example
 * ```ts
 * // Create layer from binding
 * const layer = QueueProducer.layer(env.MY_QUEUE)
 *
 * // Use in program
 * const program = Effect.gen(function*() {
 *   const queue = yield* QueueProducer
 *   yield* queue.send("Hello, Queue!")
 *   yield* queue.sendBatch([
 *     { body: "Message 1" },
 *     { body: "Message 2", delaySeconds: 60 }
 *   ])
 * }).pipe(Effect.provide(layer))
 * ```
 *
 * @see {@link QueueProducer.json} for schema-validated variant
 */
export class QueueProducer extends ServiceMap.Service<
  QueueProducer,
  {
    readonly send: (
      message: unknown,
      options?: QueueSendOptions
    ) => Effect.Effect<void, QueueSendError>;
    readonly sendBatch: (
      messages: readonly QueueBatchMessage<unknown>[]
    ) => Effect.Effect<void, QueueSendError>;
  }
>()("effectful-cloudflare/QueueProducer") {
  /**
   * Create a QueueProducer service from a binding.
   *
   * This static method wraps all Queue producer operations in Effect programs with:
   * - Automatic error handling via `Effect.tryPromise`
   * - Typed errors (`QueueSendError`)
   * - Automatic tracing spans via `Effect.fn`
   *
   * @param binding - Queue binding from worker environment
   * @returns Effect that yields the QueueProducer service
   *
   * @example
   * ```ts
   * const program = Effect.gen(function*() {
   *   const producer = yield* QueueProducer.make(env.MY_QUEUE)
   *   yield* producer.send("Hello, Queue!")
   * })
   * ```
   */
  static make = (binding: QueueBinding) =>
    Effect.gen(function* () {
      const send = Effect.fn("QueueProducer.send")(function* (
        message: unknown,
        options?: QueueSendOptions
      ) {
        yield* Effect.logDebug("QueueProducer.send");
        return yield* Effect.tryPromise({
          try: () => binding.send(message, options),
          catch: (cause) =>
            new QueueSendError({
              operation: "send",
              messageCount: 1,
              cause,
            }),
        });
      });

      const sendBatch = Effect.fn("QueueProducer.sendBatch")(function* (
        messages: readonly QueueBatchMessage<unknown>[]
      ) {
        yield* Effect.logDebug("QueueProducer.sendBatch").pipe(
          Effect.annotateLogs({ messageCount: messages.length })
        );
        return yield* Effect.tryPromise({
          try: () => binding.sendBatch(messages),
          catch: (cause) =>
            new QueueSendError({
              operation: "sendBatch",
              messageCount: messages.length,
              cause,
            }),
        });
      });

      return {
        send,
        sendBatch,
      };
    });

  /**
   * Create a Layer from a Queue binding.
   *
   * This is the standard way to provide QueueProducer service to Effect programs.
   *
   * @param binding - Queue binding from worker environment
   * @returns Layer providing QueueProducer service
   *
   * @example
   * ```ts
   * const layer = QueueProducer.layer(env.MY_QUEUE)
   *
   * const program = Effect.gen(function*() {
   *   const queue = yield* QueueProducer
   *   yield* queue.send("Hello, Queue!")
   * }).pipe(Effect.provide(layer))
   * ```
   */
  static layer = (binding: QueueBinding) =>
    Layer.effect(this, this.make(binding));

  /**
   * Create schema-validated QueueProducer variant (JSON mode).
   *
   * Returns a factory with `make` and `layer` methods that automatically:
   * - Encode messages to JSON before sending
   * - Validate against the provided schema
   * - Add `SchemaError` to the error channel
   *
   * @param schema - Schema.Schema for encoding messages
   * @returns Factory with `make` and `layer` methods
   *
   * @example
   * ```ts
   * const TaskSchema = Schema.Struct({
   *   id: Schema.String,
   *   type: Schema.Literal("email", "webhook"),
   *   payload: Schema.Record(Schema.String, Schema.Unknown),
   * })
   * type Task = Schema.Schema.Type<typeof TaskSchema>
   *
   * const taskQueue = QueueProducer.json(TaskSchema)
   * const layer = taskQueue.layer(env.TASKS_QUEUE)
   *
   * const program = Effect.gen(function*() {
   *   const queue = yield* QueueProducer
   *   // Fully typed - accepts Task
   *   yield* queue.send({
   *     id: "task-1",
   *     type: "email",
   *     payload: { to: "user@example.com" }
   *   })
   * }).pipe(Effect.provide(layer))
   * ```
   */
  static json = <A>(schema: Schema.Schema<A>) => ({
    make: (binding: QueueBinding) =>
      Effect.gen(function* () {
        const baseProducer = yield* QueueProducer.make(binding);

        const send = Effect.fn("QueueProducer.json.send")(function* (
          message: A,
          options?: QueueSendOptions
        ) {
          const encoded = yield* Schema.encodeEffect(schema)(message).pipe(
            Effect.mapError(
              (cause) =>
                new Errors.SchemaError({
                  message: "Schema encoding failed for queue message",
                  cause: cause as Error,
                })
            )
          );

          const json = yield* Effect.try({
            try: () => JSON.stringify(encoded),
            catch: (cause) =>
              new Errors.SchemaError({
                message: "Failed to stringify JSON for queue message",
                cause: cause as Error,
              }),
          });

          return yield* baseProducer.send(json, {
            ...options,
            contentType: "json",
          });
        });

        const sendBatch = Effect.fn("QueueProducer.json.sendBatch")(function* (
          messages: readonly QueueBatchMessage<A>[]
        ) {
          // Encode each message
          const encodedMessages = yield* Effect.forEach(
            messages,
            (msg) =>
              Effect.gen(function* () {
                const encoded = yield* Schema.encodeEffect(schema)(
                  msg.body
                ).pipe(
                  Effect.mapError(
                    (cause) =>
                      new Errors.SchemaError({
                        message: "Schema encoding failed for batch message",
                        cause: cause as Error,
                      })
                  )
                );

                const json = yield* Effect.try({
                  try: () => JSON.stringify(encoded),
                  catch: (cause) =>
                    new Errors.SchemaError({
                      message: "Failed to stringify JSON for batch message",
                      cause: cause as Error,
                    }),
                });

                return {
                  body: json,
                  contentType: "json" as const,
                  ...(msg.delaySeconds !== undefined && {
                    delaySeconds: msg.delaySeconds,
                  }),
                };
              }),
            { concurrency: "unbounded" }
          );

          return yield* baseProducer.sendBatch(encodedMessages);
        });

        // Return service with typed methods
        return {
          send,
          sendBatch,
        };
      }),
    layer: (binding: QueueBinding) =>
      Layer.effect(
        QueueProducer,
        // Type assertion is safe: we provide a QueueProducer-compatible service
        // with schema-validated types (A instead of unknown). The Layer system
        // handles this correctly at runtime since the shape is identical.
        QueueProducer.json(schema).make(binding) as unknown as ReturnType<
          typeof QueueProducer.make
        >
      ),
  });
}

// ── Consumer types ──────────────────────────────────────────────────────

/**
 * Metadata for a single queue message.
 *
 * Provides information about the message delivery and retry state.
 *
 * @example
 * ```ts
 * const metadata: QueueMessageMetadata = {
 *   id: "msg-123",
 *   timestamp: new Date(),
 *   attempts: 1
 * }
 * ```
 */
export interface QueueMessageMetadata {
  /**
   * Number of delivery attempts (including current attempt).
   */
  readonly attempts: number;
  /**
   * Unique message identifier.
   */
  readonly id: string;

  /**
   * Timestamp when the message was sent to the queue.
   */
  readonly timestamp: Date;
}

/**
 * Options for the queue consumer without layers.
 *
 * @example
 * ```ts
 * const options: QueueConsumerOptions = {
 *   schema: MessageSchema
 * }
 * ```
 */
export interface QueueConsumerOptions<A> {
  /**
   * Optional schema for decoding message bodies.
   * If provided, messages will be parsed as JSON and validated against the schema.
   *
   * Accepts any `Schema.Schema<A>` — concrete schemas like `Schema.Struct(...)` work directly.
   */
  readonly schema?: Schema.Schema<A>;
}

/**
 * Options for the queue consumer with layers support.
 *
 * @example
 * ```ts
 * const options: QueueConsumerWithLayersOptions<MessageType> = {
 *   schema: MessageSchema,
 *   layers: (env, ctx) => Layer.mergeAll(
 *     KV.layer(env.MY_KV as KVBinding),
 *     Worker.ExecutionCtx.layer(ctx),
 *   )
 * }
 * ```
 */
export interface QueueConsumerWithLayersOptions<A, R> {
  /**
   * Layer factory that creates layers from the worker environment and execution context.
   * When provided, the handler can use Effect services.
   */
  readonly layers: (
    env: Record<string, unknown>,
    ctx: ExecutionContext
  ) => Layer.Layer<R>;
  /**
   * Optional schema for decoding message bodies.
   * If provided, messages will be parsed as JSON and validated against the schema.
   *
   * Accepts any `Schema.Schema<A>` — concrete schemas like `Schema.Struct(...)` work directly.
   */
  readonly schema?: Schema.Schema<A>;
}

// ── Internal helpers ────────────────────────────────────────────────────

/**
 * Decode a single queue message, optionally using a schema.
 *
 * Uses `Schema.decodeUnknownEffect` for schema validation. The resulting
 * Effect may carry the schema's `DecodingServices` in its `R` channel,
 * but in practice queue message schemas don't require services.
 *
 * @internal
 */
const decodeMessage = <A>(
  msg: Message<unknown>,
  batchSize: number,
  schema?: Schema.Schema<A>
) => {
  if (schema) {
    return Effect.gen(function* () {
      const parsed = yield* Effect.try({
        try: () => JSON.parse(msg.body as string),
        catch: (cause) =>
          new QueueConsumerError({
            batchSize,
            message: `Failed to parse message ${msg.id} as JSON`,
            cause,
          }),
      });

      return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
        Effect.mapError(
          (cause) =>
            new QueueConsumerError({
              batchSize,
              message: `Schema validation failed for message ${msg.id}`,
              cause,
            })
        )
      );
    }) as Effect.Effect<A, QueueConsumerError>;
  }

  return Effect.succeed(msg.body as A) as Effect.Effect<A, QueueConsumerError>;
};

/**
 * Build metadata from a CF queue message.
 * @internal
 */
const messageMetadata = (msg: Message<unknown>): QueueMessageMetadata => ({
  id: msg.id,
  timestamp: msg.timestamp,
  attempts: msg.attempts,
});

// ── Consumer handler ────────────────────────────────────────────────────

/**
 * Create a queue consumer handler with optional schema validation.
 *
 * This function provides a fluent API for building Cloudflare Queue consumers
 * with two variants:
 *
 * **Without layers (simple):** The handler receives decoded messages and runs
 * without any Effect services. Good for stateless message processing.
 *
 * **With layers:** Pass a `layers` factory in options and the handler can use
 * any Effect service (KV, D1, etc.). Layers are created per-batch from the
 * worker environment and execution context.
 *
 * Both variants:
 * - Automatically decode messages if schema is provided
 * - Process messages one-by-one with automatic error handling
 * - Auto-ack successful messages, auto-retry failures
 * - Return a CF-compatible `{ queue }` export
 *
 * @param options - Optional configuration including schema and layers
 * @returns Object with `handler` method to define message processing logic
 *
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import { Queue } from "effectful-cloudflare"
 *
 * const MessageSchema = Schema.Struct({
 *   userId: Schema.String,
 *   action: Schema.String
 * })
 *
 * // Simple consumer without layers (no services)
 * export default Queue.consume({ schema: MessageSchema }).handler(
 *   (message, metadata) => Effect.gen(function*() {
 *     yield* Effect.log(`Processing ${metadata.id}: ${message.action}`)
 *   })
 * )
 * ```
 *
 * @example
 * ```ts
 * // Consumer WITH layers — use Effect services!
 * import { Effect, Layer, Schema } from "effect"
 * import { Queue, KV, Worker } from "effectful-cloudflare"
 *
 * export default Queue.consume({
 *   schema: MessageSchema,
 *   layers: (env, ctx) => Layer.mergeAll(
 *     KV.layer(env.MY_KV as KVBinding),
 *     Worker.ExecutionCtx.layer(ctx),
 *   )
 * }).handler(
 *   (message, metadata) => Effect.gen(function*() {
 *     const kv = yield* KV
 *     yield* kv.put(`processed:${metadata.id}`, JSON.stringify(message))
 *     yield* Effect.log(`Stored message ${metadata.id} in KV`)
 *   })
 * )
 * ```
 *
 * @example
 * ```ts
 * // Without schema (raw message bodies)
 * export default Queue.consume().handler(
 *   (message: string, metadata) => Effect.gen(function*() {
 *     yield* Effect.log(`Received: ${message}`)
 *   })
 * )
 * ```
 */
export function consume<A, R>(
  options: QueueConsumerWithLayersOptions<A, R>
): {
  handler: (
    fn: (
      message: A,
      metadata: QueueMessageMetadata
    ) => Effect.Effect<void, unknown, R>
  ) => Pick<ExportedHandler, "queue">;
};
export function consume<A = unknown>(
  options?: QueueConsumerOptions<A>
): {
  handler: (
    fn: (message: A, metadata: QueueMessageMetadata) => Effect.Effect<void>
  ) => Pick<ExportedHandler, "queue">;
};
export function consume<A = unknown, R = never>(
  options?: QueueConsumerOptions<A> | QueueConsumerWithLayersOptions<A, R>
) {
  return {
    handler: (
      fn: (
        message: A,
        metadata: QueueMessageMetadata
      ) => Effect.Effect<void, unknown, R>
    ): Pick<ExportedHandler, "queue"> => ({
      queue: async (batch, env, ctx) => {
        for (const msg of batch.messages) {
          const metadata = messageMetadata(msg);

          const processMessage = Effect.fn("Queue.consume.processMessage")(
            function* () {
              const decoded = yield* decodeMessage(
                msg,
                batch.messages.length,
                options?.schema
              );

              yield* fn(decoded, metadata);

              yield* Effect.sync(() => msg.ack());
            }
          );

          // Run per-message — provide layers if configured, then execute
          const runMessage = () => {
            if (options && "layers" in options && options.layers) {
              const layer = options.layers(env as Record<string, unknown>, ctx);
              return Effect.runPromiseExit(
                processMessage().pipe(Effect.provide(layer))
              );
            }
            return Effect.runPromiseExit(
              processMessage() as Effect.Effect<void, unknown>
            );
          };

          const result = await runMessage();

          if (result._tag === "Failure") {
            msg.retry();
          }
        }
      },
    }),
  };
}

// ── consumeEffect — Effect-based batch handler ──────────────────────────

/**
 * Create an Effect-based queue batch handler for use with `Worker.onQueue()`.
 *
 * Unlike `consume()` which returns a raw CF handler, `consumeEffect()` returns
 * a function `(batch: MessageBatch) => Effect<void, E, R>` that can be passed
 * directly to `Worker.onQueue()`. This gives you:
 *
 * - Full access to Effect services via layers (KV, D1, R2, etc.)
 * - Per-message processing with auto ack/retry
 * - Schema validation of message bodies
 * - Proper Effect error typing and tracing
 * - Batch-level error handling via `Worker.onQueue()` error propagation
 *
 * Individual message failures are handled per-message (retry on failure, ack on success).
 * If you need to fail the entire batch, throw from the handler and don't use this function —
 * use `Worker.onQueue()` directly with batch-level logic.
 *
 * @param options - Optional configuration including schema for message validation
 * @returns A function that takes a handler and returns a batch-level Effect handler
 *
 * @example
 * ```ts
 * import { Effect, Layer, Schema } from "effect"
 * import { Queue, KV, Worker } from "effectful-cloudflare"
 *
 * const MessageSchema = Schema.Struct({
 *   userId: Schema.String,
 *   action: Schema.Literal("signup", "login"),
 * })
 *
 * // Use with Worker.onQueue() for full layers support
 * export default Worker.onQueue(
 *   Queue.consumeEffect({ schema: MessageSchema }).handler(
 *     (message, metadata) => Effect.gen(function*() {
 *       const kv = yield* KV
 *       yield* kv.put(`user:${message.userId}:last-action`, message.action)
 *       yield* Effect.log(`Processed ${metadata.id}`)
 *     })
 *   ),
 *   (env, ctx) => Layer.mergeAll(
 *     KV.layer(env.MY_KV as KVBinding),
 *     Worker.ExecutionCtx.layer(ctx),
 *   )
 * )
 * ```
 *
 * @example
 * ```ts
 * // Without schema — raw message bodies
 * export default Worker.onQueue(
 *   Queue.consumeEffect().handler(
 *     (message: string, metadata) => Effect.gen(function*() {
 *       yield* Effect.log(`Received: ${message}`)
 *     })
 *   ),
 *   (env, ctx) => Worker.ExecutionCtx.layer(ctx)
 * )
 * ```
 */
export const consumeEffect = <A = unknown>(
  options?: QueueConsumerOptions<A>
) => ({
  handler:
    <E, R>(
      fn: (
        message: A,
        metadata: QueueMessageMetadata
      ) => Effect.Effect<void, E, R>
    ): ((batch: MessageBatch<unknown>) => Effect.Effect<void, never, R>) =>
    (batch: MessageBatch<unknown>) =>
      Effect.fn("Queue.consumeEffect.processBatch")(function* () {
        for (const msg of batch.messages) {
          const metadata = messageMetadata(msg);

          const processMessage = Effect.fn(
            "Queue.consumeEffect.processMessage"
          )(function* () {
            const decoded = yield* decodeMessage(
              msg,
              batch.messages.length,
              options?.schema
            );

            yield* fn(decoded, metadata);

            yield* Effect.sync(() => msg.ack());
          });

          // Run per-message — ack on success, retry on failure.
          // Errors are caught per-message so one failure doesn't block the batch.
          // This catchCause is intentional: at the consumer boundary, individual
          // message failures must be caught to retry the message without crashing
          // the entire batch.
          yield* processMessage().pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                yield* Effect.logError(
                  `Queue message ${msg.id} failed (attempt ${msg.attempts}), retrying`
                ).pipe(Effect.annotateLogs("cause", String(cause)));
                msg.retry();
              })
            )
          );
        }
      })(),
});

// ── QueueProducerMap (LayerMap for multi-queue) ─────────────────────────

/**
 * LayerMap for dynamically resolving Queue producers by binding name.
 *
 * This service allows you to work with multiple Queue bindings without
 * declaring separate layers for each queue. Queue producers are created
 * on-demand by name and cached for the lifetime of the worker request.
 *
 * @example
 * ```ts
 * import { Effect, Layer } from "effect"
 * import { QueueProducerMap, WorkerEnv } from "effectful-cloudflare"
 *
 * const program = Effect.gen(function*() {
 *   // Get email queue producer
 *   const emailQueue = yield* QueueProducerMap.get("EMAIL_QUEUE")
 *   const emailProducer = yield* emailQueue
 *   yield* emailProducer.send("Welcome email")
 *
 *   // Get webhook queue producer
 *   const webhookQueue = yield* QueueProducerMap.get("WEBHOOK_QUEUE")
 *   const webhookProducer = yield* webhookQueue
 *   yield* webhookProducer.send({ url: "https://example.com/webhook" })
 * })
 *
 * const handler = Worker.serve(
 *   (request) => program,
 *   (env, ctx) => Layer.mergeAll(
 *     WorkerEnv.layer(env),
 *     QueueProducerMap.layer,
 *   )
 * )
 * ```
 */
export class QueueProducerMap extends LayerMap.Service<QueueProducerMap>()(
  "effectful-cloudflare/QueueProducerMap",
  {
    lookup: (name: string) =>
      Layer.effect(
        QueueProducer,
        Effect.gen(function* () {
          const env = yield* WorkerEnv;
          const binding = env[name] as QueueBinding;

          if (!binding) {
            return yield* Effect.fail(
              new Errors.BindingError({
                service: "QueueProducer",
                message: `Queue binding "${name}" not found in worker environment`,
              })
            );
          }

          return yield* QueueProducer.make(binding);
        })
      ),
    idleTimeToLive: "5 minutes",
  }
) {}
