import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { QueueProducer } from "../src/Queue.js";
import { memoryQueue } from "../src/Testing.js";

// ── Basic send operations ───────────────────────────────────────────────

it.effect("send adds message to queue", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    yield* queue.send("Hello, Queue!");

    expect(binding.messages).toHaveLength(1);
    expect(binding.messages[0]?.body).toBe("Hello, Queue!");
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});

it.effect("send with options sets contentType and delaySeconds", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    yield* queue.send("Delayed message", {
      contentType: "text/plain",
      delaySeconds: 60,
    });

    expect(binding.messages).toHaveLength(1);
    expect(binding.messages[0]?.body).toBe("Delayed message");
    expect(binding.messages[0]?.contentType).toBe("text/plain");
    expect(binding.messages[0]?.delaySeconds).toBe(60);
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});

it.effect("send can send objects", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    const message = { type: "task", data: "process" };
    yield* queue.send(message);

    expect(binding.messages).toHaveLength(1);
    expect(binding.messages[0]?.body).toEqual(message);
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});

it.effect("send multiple messages sequentially", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    yield* queue.send("Message 1");
    yield* queue.send("Message 2");
    yield* queue.send("Message 3");

    expect(binding.messages).toHaveLength(3);
    expect(binding.messages[0]?.body).toBe("Message 1");
    expect(binding.messages[1]?.body).toBe("Message 2");
    expect(binding.messages[2]?.body).toBe("Message 3");
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});

// ── Batch send operations ───────────────────────────────────────────────

it.effect("sendBatch sends multiple messages", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    yield* queue.sendBatch([
      { body: "Batch message 1" },
      { body: "Batch message 2" },
      { body: "Batch message 3" },
    ]);

    expect(binding.messages).toHaveLength(3);
    expect(binding.messages[0]?.body).toBe("Batch message 1");
    expect(binding.messages[1]?.body).toBe("Batch message 2");
    expect(binding.messages[2]?.body).toBe("Batch message 3");
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});

it.effect("sendBatch with options", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    yield* queue.sendBatch([
      { body: "Message 1", contentType: "text/plain" },
      { body: "Message 2", delaySeconds: 30 },
      { body: "Message 3", contentType: "application/json", delaySeconds: 60 },
    ]);

    expect(binding.messages).toHaveLength(3);
    expect(binding.messages[0]?.contentType).toBe("text/plain");
    expect(binding.messages[0]?.delaySeconds).toBeUndefined();
    expect(binding.messages[1]?.delaySeconds).toBe(30);
    expect(binding.messages[2]?.contentType).toBe("application/json");
    expect(binding.messages[2]?.delaySeconds).toBe(60);
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});

it.effect("sendBatch with empty array", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    yield* queue.sendBatch([]);

    expect(binding.messages).toHaveLength(0);
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});

it.effect("sendBatch with object messages", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    yield* queue.sendBatch([
      { body: { type: "email", to: "user1@example.com" } },
      { body: { type: "webhook", url: "https://example.com/hook" } },
    ]);

    expect(binding.messages).toHaveLength(2);
    expect(binding.messages[0]?.body).toEqual({
      type: "email",
      to: "user1@example.com",
    });
    expect(binding.messages[1]?.body).toEqual({
      type: "webhook",
      url: "https://example.com/hook",
    });
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});

// ── Complex workflow ────────────────────────────────────────────────────

it.effect("complex workflow - mixed send and sendBatch", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    // Send single message
    yield* queue.send("Single message");

    // Send batch
    yield* queue.sendBatch([{ body: "Batch 1" }, { body: "Batch 2" }]);

    // Send another single message
    yield* queue.send("Another single", { delaySeconds: 10 });

    // Send another batch
    yield* queue.sendBatch([{ body: "Batch 3", delaySeconds: 20 }]);

    expect(binding.messages).toHaveLength(5);
    expect(binding.messages[0]?.body).toBe("Single message");
    expect(binding.messages[1]?.body).toBe("Batch 1");
    expect(binding.messages[2]?.body).toBe("Batch 2");
    expect(binding.messages[3]?.body).toBe("Another single");
    expect(binding.messages[3]?.delaySeconds).toBe(10);
    expect(binding.messages[4]?.body).toBe("Batch 3");
    expect(binding.messages[4]?.delaySeconds).toBe(20);
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});

// ── Schema-validated JSON mode ──────────────────────────────────────────

const TaskSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["email", "webhook"]),
  payload: Schema.Record(Schema.String, Schema.Unknown),
});
type Task = typeof TaskSchema.Type;

it.effect("JSON mode - send encodes and validates message", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    const task: Task = {
      id: "task-1",
      type: "email",
      payload: { to: "user@example.com", subject: "Hello" },
    };

    yield* queue.send(task);

    expect(binding.messages).toHaveLength(1);
    expect(binding.messages[0]?.contentType).toBe("application/json");

    // Parse the JSON message
    const body = binding.messages[0]?.body;
    expect(typeof body).toBe("string");
    const parsed = JSON.parse(body as string);
    expect(parsed.id).toBe("task-1");
    expect(parsed.type).toBe("email");
    expect(parsed.payload).toEqual({
      to: "user@example.com",
      subject: "Hello",
    });
  }).pipe(Effect.provide(QueueProducer.json(TaskSchema).layer(binding)));
});

it.effect("JSON mode - send with custom options", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    const task: Task = {
      id: "task-2",
      type: "webhook",
      payload: { url: "https://example.com" },
    };

    yield* queue.send(task, { delaySeconds: 30 });

    expect(binding.messages).toHaveLength(1);
    expect(binding.messages[0]?.contentType).toBe("application/json");
    expect(binding.messages[0]?.delaySeconds).toBe(30);
  }).pipe(Effect.provide(QueueProducer.json(TaskSchema).layer(binding)));
});

it.effect("JSON mode - sendBatch encodes multiple messages", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    const tasks: Task[] = [
      { id: "1", type: "email", payload: { to: "user1@example.com" } },
      { id: "2", type: "webhook", payload: { url: "https://example.com/1" } },
      { id: "3", type: "email", payload: { to: "user2@example.com" } },
    ];

    yield* queue.sendBatch(tasks.map((body) => ({ body })));

    expect(binding.messages).toHaveLength(3);

    // Verify all messages are JSON encoded
    for (let i = 0; i < 3; i++) {
      expect(binding.messages[i]?.contentType).toBe("application/json");
      const parsed = JSON.parse(binding.messages[i]?.body as string);
      expect(parsed.id).toBe(tasks[i]?.id);
      expect(parsed.type).toBe(tasks[i]?.type);
    }
  }).pipe(Effect.provide(QueueProducer.json(TaskSchema).layer(binding)));
});

it.effect("JSON mode - sendBatch with options", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    const task1: Task = {
      id: "1",
      type: "email",
      payload: { to: "user@example.com" },
    };
    const task2: Task = {
      id: "2",
      type: "webhook",
      payload: { url: "https://example.com" },
    };

    yield* queue.sendBatch([
      { body: task1 },
      { body: task2, delaySeconds: 60 },
    ]);

    expect(binding.messages).toHaveLength(2);
    expect(binding.messages[0]?.delaySeconds).toBeUndefined();
    expect(binding.messages[1]?.delaySeconds).toBe(60);

    // Both should have JSON content type
    expect(binding.messages[0]?.contentType).toBe("application/json");
    expect(binding.messages[1]?.contentType).toBe("application/json");
  }).pipe(Effect.provide(QueueProducer.json(TaskSchema).layer(binding)));
});

it.effect("JSON mode - handles complex nested objects", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    const task: Task = {
      id: "complex-1",
      type: "email",
      payload: {
        to: "user@example.com",
        metadata: {
          tags: ["important", "urgent"],
          priority: 1,
          nested: {
            deep: {
              value: "deeply nested",
            },
          },
        },
      },
    };

    yield* queue.send(task);

    const body = binding.messages[0]?.body;
    const parsed = JSON.parse(body as string);
    expect(parsed.payload.metadata.tags).toEqual(["important", "urgent"]);
    expect(parsed.payload.metadata.nested.deep.value).toBe("deeply nested");
  }).pipe(Effect.provide(QueueProducer.json(TaskSchema).layer(binding)));
});

it.effect("JSON mode - sendBatch with empty array", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    yield* queue.sendBatch([]);

    expect(binding.messages).toHaveLength(0);
  }).pipe(Effect.provide(QueueProducer.json(TaskSchema).layer(binding)));
});

// ── Message inspection ──────────────────────────────────────────────────

it.effect("messages array allows test inspection", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    // Verify messages array is initially empty
    expect(binding.messages).toHaveLength(0);

    // Send messages
    yield* queue.send("Message 1");
    expect(binding.messages).toHaveLength(1);

    yield* queue.sendBatch([{ body: "Message 2" }, { body: "Message 3" }]);
    expect(binding.messages).toHaveLength(3);

    // Verify we can inspect message details
    expect(binding.messages[0]?.body).toBe("Message 1");
    expect(binding.messages[1]?.body).toBe("Message 2");
    expect(binding.messages[2]?.body).toBe("Message 3");

    // Verify messages array is mutable (can be cleared for next test)
    binding.messages.length = 0;
    expect(binding.messages).toHaveLength(0);
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});

// ── Integration patterns ────────────────────────────────────────────────

it.effect("queue operations with Effect.forEach", () => {
  const binding = memoryQueue();
  return Effect.gen(function* () {
    const queue = yield* QueueProducer;

    const items = ["Item 1", "Item 2", "Item 3"];

    yield* Effect.forEach(items, (item) => queue.send(item));

    expect(binding.messages).toHaveLength(3);
    expect(binding.messages.map((m) => m.body)).toEqual(items);
  }).pipe(Effect.provide(QueueProducer.layer(binding)));
});
