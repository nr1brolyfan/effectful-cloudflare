import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Pipeline } from "../src/Pipeline.js";
import { memoryPipeline } from "../src/Testing.js";

// ── Basic operations ────────────────────────────────────────────────────

it.effect("sends single event to pipeline", () => {
  const binding = memoryPipeline();

  return Effect.gen(function* () {
    const pipeline = yield* Pipeline;

    yield* pipeline.send({
      user_id: "123",
      event_type: "click",
      timestamp: Date.now(),
    });

    expect(binding.events).toHaveLength(1);
    expect(binding.events[0]).toMatchObject({
      user_id: "123",
      event_type: "click",
    });
  }).pipe(Effect.provide(Pipeline.layer(binding)));
});

it.effect("sends batch of events to pipeline", () => {
  const binding = memoryPipeline();

  return Effect.gen(function* () {
    const pipeline = yield* Pipeline;

    yield* pipeline.sendBatch([
      { user_id: "user1", event_type: "view", timestamp: Date.now() },
      { user_id: "user2", event_type: "click", timestamp: Date.now() },
      {
        user_id: "user3",
        event_type: "purchase",
        amount: 50,
        timestamp: Date.now(),
      },
    ]);

    expect(binding.events).toHaveLength(3);
    expect(binding.events[0]).toHaveProperty("user_id", "user1");
    expect(binding.events[1]).toHaveProperty("user_id", "user2");
    expect(binding.events[2]).toHaveProperty("amount", 50);
  }).pipe(Effect.provide(Pipeline.layer(binding)));
});

it.effect("send() works with single object", () => {
  const binding = memoryPipeline();

  return Effect.gen(function* () {
    const pipeline = yield* Pipeline;

    yield* pipeline.send({
      event: "test",
      data: { key: "value" },
    });

    expect(binding.events).toHaveLength(1);
    expect(binding.events[0]).toEqual({
      event: "test",
      data: { key: "value" },
    });
  }).pipe(Effect.provide(Pipeline.layer(binding)));
});

it.effect("send() works with array of objects", () => {
  const binding = memoryPipeline();

  return Effect.gen(function* () {
    const pipeline = yield* Pipeline;

    // send() can also take an array
    yield* pipeline.send([
      { event: "event1" },
      { event: "event2" },
      { event: "event3" },
    ]);

    expect(binding.events).toHaveLength(3);
    expect(binding.events[0]).toEqual({ event: "event1" });
    expect(binding.events[1]).toEqual({ event: "event2" });
    expect(binding.events[2]).toEqual({ event: "event3" });
  }).pipe(Effect.provide(Pipeline.layer(binding)));
});

// ── Complex event data ──────────────────────────────────────────────────

it.effect("sends events with nested objects", () => {
  const binding = memoryPipeline();

  return Effect.gen(function* () {
    const pipeline = yield* Pipeline;

    yield* pipeline.send({
      user_id: "456",
      event_type: "purchase",
      product: {
        id: "prod-123",
        name: "Widget",
        price: 29.99,
      },
      metadata: {
        source: "web",
        campaign: "summer-sale",
      },
      timestamp: Date.now(),
    });

    expect(binding.events).toHaveLength(1);
    const event = binding.events[0] as {
      user_id: string;
      product: { id: string; name: string; price: number };
    };
    expect(event.user_id).toBe("456");
    expect(event.product.id).toBe("prod-123");
    expect(event.product.price).toBe(29.99);
  }).pipe(Effect.provide(Pipeline.layer(binding)));
});

it.effect("sends events with arrays", () => {
  const binding = memoryPipeline();

  return Effect.gen(function* () {
    const pipeline = yield* Pipeline;

    yield* pipeline.send({
      user_id: "789",
      event_type: "cart_update",
      items: [
        { product_id: "p1", quantity: 2 },
        { product_id: "p2", quantity: 1 },
        { product_id: "p3", quantity: 5 },
      ],
      tags: ["electronics", "sale", "featured"],
    });

    expect(binding.events).toHaveLength(1);
    const event = binding.events[0] as {
      items: { product_id: string; quantity: number }[];
      tags: string[];
    };
    expect(event.items).toHaveLength(3);
    expect(event.tags).toEqual(["electronics", "sale", "featured"]);
  }).pipe(Effect.provide(Pipeline.layer(binding)));
});

// ── Multiple sends accumulate ───────────────────────────────────────────

it.effect("multiple send operations accumulate events", () => {
  const binding = memoryPipeline();

  return Effect.gen(function* () {
    const pipeline = yield* Pipeline;

    // Send first event
    yield* pipeline.send({ event: "first" });
    expect(binding.events).toHaveLength(1);

    // Send second event
    yield* pipeline.send({ event: "second" });
    expect(binding.events).toHaveLength(2);

    // Send batch
    yield* pipeline.sendBatch([{ event: "third" }, { event: "fourth" }]);
    expect(binding.events).toHaveLength(4);

    // Verify all events are present
    expect(binding.events[0]).toEqual({ event: "first" });
    expect(binding.events[1]).toEqual({ event: "second" });
    expect(binding.events[2]).toEqual({ event: "third" });
    expect(binding.events[3]).toEqual({ event: "fourth" });
  }).pipe(Effect.provide(Pipeline.layer(binding)));
});

// ── Error handling ──────────────────────────────────────────────────────

it.effect("wraps binding errors in PipelineError", () =>
  Effect.gen(function* () {
    const errorBinding = {
      send: () => Promise.reject(new Error("Pipeline send failed")),
      events: [],
    };

    const pipeline = yield* Pipeline.make(errorBinding);

    const result = yield* pipeline.send({ event: "test" }).pipe(Effect.flip);

    expect(result._tag).toBe("PipelineError");
    if (result._tag === "PipelineError") {
      expect(result.operation).toBe("send");
      expect(result.message).toBe("Failed to send events to pipeline");
    }
  })
);

it.effect("can catch PipelineError with catchTag", () =>
  Effect.gen(function* () {
    const errorBinding = {
      send: () => Promise.reject(new Error("Network error")),
      events: [],
    };

    const pipeline = yield* Pipeline.make(errorBinding);

    const result = yield* pipeline
      .send({ event: "test" })
      .pipe(
        Effect.catchTag("PipelineError", (error) =>
          Effect.succeed(`Error in ${error.operation}: ${error.message}`)
        )
      );

    expect(result).toBe("Error in send: Failed to send events to pipeline");
  })
);

it.effect("sendBatch error includes event count", () =>
  Effect.gen(function* () {
    const errorBinding = {
      send: () => Promise.reject(new Error("Batch send failed")),
      events: [],
    };

    const pipeline = yield* Pipeline.make(errorBinding);

    const events = [{ event: "e1" }, { event: "e2" }, { event: "e3" }];
    const result = yield* pipeline.sendBatch(events).pipe(Effect.flip);

    expect(result._tag).toBe("PipelineError");
    if (result._tag === "PipelineError") {
      expect(result.operation).toBe("sendBatch");
      expect(result.message).toContain("3 events");
    }
  })
);

// ── Real-world usage patterns ───────────────────────────────────────────

it.effect("analytics event tracking pattern", () => {
  const binding = memoryPipeline();

  return Effect.gen(function* () {
    const pipeline = yield* Pipeline;

    // Track page view
    yield* pipeline.send({
      event_type: "page_view",
      user_id: "user123",
      page: "/products",
      referrer: "https://google.com",
      timestamp: Date.now(),
    });

    // Track user interaction
    yield* pipeline.send({
      event_type: "button_click",
      user_id: "user123",
      button_id: "add-to-cart",
      product_id: "widget-001",
      timestamp: Date.now(),
    });

    // Track conversion
    yield* pipeline.send({
      event_type: "purchase",
      user_id: "user123",
      order_id: "ord-456",
      total: 149.99,
      currency: "USD",
      items: [{ product_id: "widget-001", quantity: 1, price: 149.99 }],
      timestamp: Date.now(),
    });

    expect(binding.events).toHaveLength(3);
    expect(binding.events[0]).toHaveProperty("event_type", "page_view");
    expect(binding.events[1]).toHaveProperty("event_type", "button_click");
    expect(binding.events[2]).toHaveProperty("event_type", "purchase");
  }).pipe(Effect.provide(Pipeline.layer(binding)));
});

it.effect("batch logging pattern", () => {
  const binding = memoryPipeline();

  return Effect.gen(function* () {
    const pipeline = yield* Pipeline;

    // Collect logs during request processing
    const logs = [
      {
        level: "info",
        message: "Request started",
        request_id: "req-789",
        timestamp: Date.now(),
      },
      {
        level: "debug",
        message: "Database query executed",
        request_id: "req-789",
        duration_ms: 15,
        timestamp: Date.now(),
      },
      {
        level: "info",
        message: "Request completed",
        request_id: "req-789",
        status_code: 200,
        timestamp: Date.now(),
      },
    ];

    // Send all logs in one batch
    yield* pipeline.sendBatch(logs);

    expect(binding.events).toHaveLength(3);
    expect(binding.events.every((e) => "request_id" in e)).toBe(true);
  }).pipe(Effect.provide(Pipeline.layer(binding)));
});

// ── Empty batch handling ────────────────────────────────────────────────

it.effect("handles empty batch", () => {
  const binding = memoryPipeline();

  return Effect.gen(function* () {
    const pipeline = yield* Pipeline;

    yield* pipeline.sendBatch([]);

    expect(binding.events).toHaveLength(0);
  }).pipe(Effect.provide(Pipeline.layer(binding)));
});
