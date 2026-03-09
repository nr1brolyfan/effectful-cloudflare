/// <reference types="@cloudflare/workers-types" />
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  ExecutionCtx,
  onQueue,
  onScheduled,
  serve,
  WorkerEnv,
} from "../src/Worker.js";

// ── Helper: minimal mock factories ──────────────────────────────────────

const mockExecutionContext = () => {
  const promises: Promise<unknown>[] = [];
  const passedThrough: boolean[] = [];
  return {
    promises,
    passedThrough,
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise);
    },
    passThroughOnException() {
      passedThrough.push(true);
    },
  } as unknown as ExecutionContext & {
    promises: Promise<unknown>[];
    passedThrough: boolean[];
  };
};

const mockScheduledController = () =>
  ({
    scheduledTime: Date.now(),
    cron: "*/5 * * * *",
    noRetry() {
      /* noop */
    },
  }) as unknown as ScheduledController;

// biome-ignore lint/suspicious/noExplicitAny: test helper
const mockRequest = (url: string) => new Request(url) as any;

const mockMessageBatch = <T>(messages: Array<{ id: string; body: T }> = []) =>
  ({
    queue: "test-queue",
    messages: messages.map((m) => ({
      id: m.id,
      timestamp: new Date(),
      body: m.body,
      attempts: 1,
      ack() {
        /* noop */
      },
      retry() {
        /* noop */
      },
    })),
    ackAll() {
      /* noop */
    },
    retryAll() {
      /* noop */
    },
  }) as unknown as MessageBatch<T>;

// ── WorkerEnv ───────────────────────────────────────────────────────────

it.effect("WorkerEnv.layer provides env record", () =>
  Effect.gen(function* () {
    const env = yield* WorkerEnv;
    expect(env.MY_KV).toBe("kv-binding");
    expect(env.DB).toBe("d1-binding");
  }).pipe(
    Effect.provide(WorkerEnv.layer({ MY_KV: "kv-binding", DB: "d1-binding" }))
  )
);

// ── ExecutionCtx ────────────────────────────────────────────────────────

it.effect("ExecutionCtx.make wraps waitUntil", () =>
  Effect.gen(function* () {
    const ctx = mockExecutionContext();
    const execCtx = yield* ExecutionCtx.make(ctx);

    yield* execCtx.waitUntil(Effect.void);

    expect(ctx.promises).toHaveLength(1);
  })
);

it.effect("ExecutionCtx.make wraps passThroughOnException", () =>
  Effect.gen(function* () {
    const ctx = mockExecutionContext();
    const execCtx = yield* ExecutionCtx.make(ctx);

    yield* execCtx.passThroughOnException();

    expect(ctx.passedThrough).toHaveLength(1);
  })
);

it.effect("ExecutionCtx.layer provides the service", () =>
  Effect.gen(function* () {
    const execCtx = yield* ExecutionCtx;
    yield* execCtx.passThroughOnException();
  }).pipe(Effect.provide(ExecutionCtx.layer(mockExecutionContext())))
);

// ── ExecutionCtx static helpers ──────────────────────────────────────────

it.effect("ExecutionCtx.waitUntil static schedules background work", () => {
  const ctx = mockExecutionContext();
  return Effect.gen(function* () {
    yield* ExecutionCtx.waitUntil(Effect.void);
    expect(ctx.promises).toHaveLength(1);
  }).pipe(Effect.provide(ExecutionCtx.layer(ctx)));
});

it.effect(
  "ExecutionCtx.passThroughOnException static enables pass-through",
  () => {
    const ctx = mockExecutionContext();
    return Effect.gen(function* () {
      yield* ExecutionCtx.passThroughOnException();
      expect(ctx.passedThrough).toHaveLength(1);
    }).pipe(Effect.provide(ExecutionCtx.layer(ctx)));
  }
);

// ── serve() ─────────────────────────────────────────────────────────────

it("serve returns handler with fetch method", () => {
  const handler = serve(
    (_request) => Effect.succeed(new Response("OK")),
    () => Layer.empty
  );
  expect(handler).toHaveProperty("fetch");
  expect(typeof handler.fetch).toBe("function");
});

it("serve.fetch returns Response from handler", async () => {
  const handler = serve(
    (request) =>
      Effect.succeed(
        new Response(`Hello from ${new URL(request.url).pathname}`)
      ),
    () => Layer.empty
  );

  const response = await handler.fetch?.(
    mockRequest("https://example.com/test"),
    {},
    mockExecutionContext()
  );

  expect(response).toBeInstanceOf(Response);
  expect(response?.status).toBe(200);
  const text = await response?.text();
  expect(text).toBe("Hello from /test");
});

it("serve.fetch returns 500 on unhandled errors", async () => {
  const handler = serve(
    (_request) => Effect.fail("boom" as const),
    () => Layer.empty
  );

  const response = await handler.fetch?.(
    mockRequest("https://example.com/"),
    {},
    mockExecutionContext()
  );

  expect(response?.status).toBe(500);
  const body = await response?.json();
  expect(body).toEqual({ error: "Internal Server Error" });
});

it("serve.fetch provides layers to handler", async () => {
  const handler = serve(
    (_request) =>
      Effect.gen(function* () {
        const env = yield* WorkerEnv;
        return new Response(`KV=${env.MY_KV}`);
      }),
    (env: Record<string, unknown>) => WorkerEnv.layer(env)
  );

  const response = await handler.fetch?.(
    mockRequest("https://example.com/"),
    { MY_KV: "test-kv" },
    mockExecutionContext()
  );

  const text = await response?.text();
  expect(text).toBe("KV=test-kv");
});

// ── onScheduled() ───────────────────────────────────────────────────────

it("onScheduled returns handler with scheduled method", () => {
  const handler = onScheduled(
    (_controller) => Effect.void,
    () => Layer.empty
  );
  expect(handler).toHaveProperty("scheduled");
  expect(typeof handler.scheduled).toBe("function");
});

it("onScheduled.scheduled executes handler", async () => {
  let executed = false;

  const handler = onScheduled(
    (_controller) =>
      Effect.sync(() => {
        executed = true;
      }),
    () => Layer.empty
  );

  await handler.scheduled?.(
    mockScheduledController(),
    {},
    mockExecutionContext()
  );

  expect(executed).toBe(true);
});

it("onScheduled provides layers to handler", async () => {
  let envValue: unknown = null;

  const handler = onScheduled(
    (_controller) =>
      Effect.gen(function* () {
        const env = yield* WorkerEnv;
        envValue = env.SECRET;
      }),
    (env: Record<string, unknown>) => WorkerEnv.layer(env)
  );

  await handler.scheduled?.(
    mockScheduledController(),
    { SECRET: "my-secret" },
    mockExecutionContext()
  );

  expect(envValue).toBe("my-secret");
});

it("onScheduled does not throw on handler error", async () => {
  const handler = onScheduled(
    (_controller) => Effect.fail("scheduled-error"),
    () => Layer.empty
  );

  // Should not throw — errors are caught and logged
  await handler.scheduled?.(
    mockScheduledController(),
    {},
    mockExecutionContext()
  );
});

// ── onQueue() ───────────────────────────────────────────────────────────

it("onQueue returns handler with queue method", () => {
  const handler = onQueue(
    (_batch) => Effect.void,
    () => Layer.empty
  );
  expect(handler).toHaveProperty("queue");
  expect(typeof handler.queue).toBe("function");
});

it("onQueue.queue executes handler with batch", async () => {
  const processedIds: string[] = [];

  const handler = onQueue(
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    (batch: MessageBatch<any>) =>
      Effect.sync(() => {
        for (const msg of batch.messages) {
          processedIds.push((msg.body as { id: string }).id);
        }
      }),
    () => Layer.empty
  );

  const batch = mockMessageBatch([
    { id: "msg-1", body: { id: "item-1" } },
    { id: "msg-2", body: { id: "item-2" } },
  ]);

  await handler.queue?.(batch, {}, mockExecutionContext());

  expect(processedIds).toEqual(["item-1", "item-2"]);
});

it("onQueue provides layers to handler", async () => {
  let envValue: unknown = null;

  const handler = onQueue(
    (_batch) =>
      Effect.gen(function* () {
        const env = yield* WorkerEnv;
        envValue = env.DB;
      }),
    (env: Record<string, unknown>) => WorkerEnv.layer(env)
  );

  await handler.queue?.(
    mockMessageBatch(),
    { DB: "my-db" },
    mockExecutionContext()
  );

  expect(envValue).toBe("my-db");
});

it("onQueue does not throw on handler error", async () => {
  const handler = onQueue(
    (_batch) => Effect.fail("queue-error"),
    () => Layer.empty
  );

  // Should not throw — errors are caught and logged
  await handler.queue?.(mockMessageBatch(), {}, mockExecutionContext());
});
