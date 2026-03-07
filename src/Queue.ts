import { Data, Effect, Layer, Schema, ServiceMap } from "effect";
import * as Errors from "./Errors.js";

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
export type QueueBinding<T = unknown> = {
	send(
		message: T,
		options?: { contentType?: string; delaySeconds?: number },
	): Promise<void>;
	sendBatch(
		messages: ReadonlyArray<{
			body: T;
			contentType?: string;
			delaySeconds?: number;
		}>,
	): Promise<void>;
};

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
	 * MIME type of the message content.
	 * @default "text/plain"
	 */
	readonly contentType?: string;

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
	 * MIME type of the message content.
	 * @default "text/plain"
	 */
	readonly contentType?: string;

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
			options?: QueueSendOptions,
		) => Effect.Effect<void, QueueSendError>;
		readonly sendBatch: (
			messages: ReadonlyArray<QueueBatchMessage<unknown>>,
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
				options?: QueueSendOptions,
			) {
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
				messages: ReadonlyArray<QueueBatchMessage<unknown>>,
			) {
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
					options?: QueueSendOptions,
				) {
					const encoded = yield* Schema.encodeEffect(schema)(message).pipe(
						Effect.mapError(
							(cause) =>
								new Errors.SchemaError({
									message: "Schema encoding failed for queue message",
									cause: cause as Error,
								}),
						),
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
						contentType: "application/json",
					});
				});

				const sendBatch = Effect.fn("QueueProducer.json.sendBatch")(
					function* (messages: ReadonlyArray<QueueBatchMessage<A>>) {
						// Encode each message
						const encodedMessages = yield* Effect.forEach(
							messages,
							(msg) =>
								Effect.gen(function* () {
									const encoded = yield* Schema.encodeEffect(schema)(
										msg.body,
									).pipe(
										Effect.mapError(
											(cause) =>
												new Errors.SchemaError({
													message: "Schema encoding failed for batch message",
													cause: cause as Error,
												}),
										),
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
										contentType: "application/json",
										...(msg.delaySeconds !== undefined && {
											delaySeconds: msg.delaySeconds,
										}),
									};
								}),
							{ concurrency: "unbounded" },
						);

						return yield* baseProducer.sendBatch(encodedMessages);
					},
				);

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
				>,
			),
	});
}
