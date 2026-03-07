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
