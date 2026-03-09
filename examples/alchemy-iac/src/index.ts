/**
 * Alchemy IaC Example Worker
 *
 * Demonstrates:
 * - Multiple Cloudflare bindings (KV, D1, R2, Queue)
 * - Effect v4 service composition
 * - Infrastructure as Code with Alchemy
 * - Type-safe bindings from alchemy.run.ts
 */

import { Effect, Layer, Logger, References, Schema } from "effect";
import { D1 } from "effectful-cloudflare/D1";
import { KV } from "effectful-cloudflare/KV";
import { QueueProducer } from "effectful-cloudflare/Queue";
import { R2 } from "effectful-cloudflare/R2";
import { serve } from "effectful-cloudflare/Worker";
import type { Env } from "../alchemy.run";

// ── Schemas ────────────────────────────────────────────────────────────────

const CacheValue = Schema.Struct({
  value: Schema.String,
  timestamp: Schema.Number,
  ttl: Schema.Number,
});

type CacheValue = typeof CacheValue.Type;

const TaskMessage = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["process", "analyze", "cleanup"]),
  data: Schema.Unknown,
  createdAt: Schema.String,
});

type TaskMessage = typeof TaskMessage.Type;

// ── Route Patterns ─────────────────────────────────────────────────────────

const CACHE_GET_PATTERN = /^\/cache\/([^/]+)$/;

// ── Route Handlers ─────────────────────────────────────────────────────────

/**
 * GET /
 * API overview
 */
const indexRoute = () =>
  Effect.succeed(
    Response.json({
      service: "effectful-cloudflare alchemy-iac example",
      endpoints: {
        "GET /": "API overview",
        "GET /cache/:key": "Get cached value",
        "POST /cache": "Set cache value (body: { key, value, ttl })",
        "GET /analytics": "Get analytics summary from D1",
        "POST /analytics": "Record event (body: { event, metadata })",
        "GET /files": "List R2 files",
        "POST /files": "Upload file (body: { key, content })",
        "POST /tasks": "Queue a task (body: { type, data })",
      },
    })
  );

/**
 * GET /cache/:key
 * Get value from KV cache with schema validation
 */
const getCachedValue = (key: string) =>
  Effect.gen(function* () {
    yield* Effect.logDebug("Getting cached value", { key });
    const kv = yield* KV;
    const cached = yield* kv.get(key);

    if (!cached) {
      yield* Effect.logInfo("Cache miss", { key });
      return Response.json({ error: "Cache miss" }, { status: 404 });
    }

    yield* Effect.logDebug("Cache hit", { key });
    return Response.json({ key, ...cached });
  });

/**
 * POST /cache
 * Store value in KV cache with TTL
 */
const setCachedValue = (data: { key: string; value: string; ttl: number }) =>
  Effect.gen(function* () {
    yield* Effect.logDebug("Storing value in cache", {
      key: data.key,
      ttl: data.ttl,
    });
    const kv = yield* KV;

    const cacheValue: CacheValue = {
      value: data.value,
      timestamp: Date.now(),
      ttl: data.ttl,
    };

    yield* kv.put(data.key, cacheValue, {
      expirationTtl: data.ttl,
    });

    yield* Effect.logInfo("Cache value stored successfully", {
      key: data.key,
      expiresIn: data.ttl,
    });

    return Response.json({
      success: true,
      key: data.key,
      expiresIn: data.ttl,
    });
  });

/**
 * GET /analytics
 * Get analytics summary from D1
 */
const getAnalytics = () =>
  Effect.gen(function* () {
    const db = yield* D1;

    // Ensure table exists
    yield* db.exec(
      "CREATE TABLE IF NOT EXISTS analytics_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, metadata TEXT, timestamp TEXT NOT NULL)"
    );

    // Query event counts
    const summary = yield* db.query<{
      event: string;
      count: number;
    }>("SELECT event, COUNT(*) as count FROM analytics_events GROUP BY event");

    const total = yield* db.queryFirst<{ total: number }>(
      "SELECT COUNT(*) as total FROM analytics_events"
    );

    return Response.json({
      summary,
      total: total?.total ?? 0,
    });
  });

/**
 * POST /analytics
 * Record an analytics event in D1
 */
const recordEvent = (data: { event: string; metadata?: unknown }) =>
  Effect.gen(function* () {
    yield* Effect.logDebug("Recording analytics event", {
      event: data.event,
      hasMetadata: !!data.metadata,
    });
    const db = yield* D1;

    // Ensure table exists
    yield* db.exec(
      "CREATE TABLE IF NOT EXISTS analytics_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, metadata TEXT, timestamp TEXT NOT NULL)"
    );

    // Insert event
    yield* db.query(
      "INSERT INTO analytics_events (event, metadata, timestamp) VALUES (?, ?, ?)",
      [data.event, JSON.stringify(data.metadata), new Date().toISOString()]
    );

    yield* Effect.logInfo("Analytics event recorded", { event: data.event });

    return Response.json({ success: true, event: data.event });
  });

/**
 * GET /files
 * List files in R2 bucket
 */
const listFiles = () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    const result = yield* r2.list({ limit: 100 });

    const files = result.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
    }));

    return Response.json({
      files,
      truncated: result.truncated,
    });
  });

/**
 * POST /files
 * Upload a file to R2
 */
const uploadFile = (data: { key: string; content: string }) =>
  Effect.gen(function* () {
    yield* Effect.logDebug("Uploading file to R2", {
      key: data.key,
      size: data.content.length,
    });
    const r2 = yield* R2;

    yield* r2.put(data.key, data.content, {
      httpMetadata: {
        contentType: "text/plain",
      },
    });

    yield* Effect.logInfo("File uploaded successfully", {
      key: data.key,
      size: data.content.length,
    });

    return Response.json({
      success: true,
      key: data.key,
      size: data.content.length,
    });
  });

/**
 * POST /tasks
 * Queue a task for async processing
 */
const queueTask = (data: {
  type: "process" | "analyze" | "cleanup";
  data: unknown;
}) =>
  Effect.gen(function* () {
    yield* Effect.logDebug("Queueing task", { type: data.type });
    const queue = yield* QueueProducer;

    const task: TaskMessage = {
      id: crypto.randomUUID(),
      type: data.type,
      data: data.data,
      createdAt: new Date().toISOString(),
    };

    yield* queue.send(task);

    yield* Effect.logInfo("Task queued successfully", {
      taskId: task.id,
      type: task.type,
    });

    return Response.json({
      success: true,
      taskId: task.id,
      type: task.type,
    });
  });

// ── Router ─────────────────────────────────────────────────────────────────

const handler = (request: Request) =>
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Router with multiple endpoints
  Effect.gen(function* () {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    yield* Effect.logDebug("Incoming request", { method, path });

    // GET /
    if (path === "/" && method === "GET") {
      return yield* indexRoute();
    }

    // GET /cache/:key
    const cacheGetMatch = path.match(CACHE_GET_PATTERN);
    if (cacheGetMatch && method === "GET") {
      const key = cacheGetMatch[1];
      if (!key) {
        return Response.json({ error: "Invalid key" }, { status: 400 });
      }
      return yield* getCachedValue(key);
    }

    // POST /cache
    if (path === "/cache" && method === "POST") {
      const data = (yield* Effect.tryPromise(() => request.json())) as {
        key: string;
        value: string;
        ttl: number;
      };
      return yield* setCachedValue(data);
    }

    // GET /analytics
    if (path === "/analytics" && method === "GET") {
      return yield* getAnalytics();
    }

    // POST /analytics
    if (path === "/analytics" && method === "POST") {
      const data = (yield* Effect.tryPromise(() => request.json())) as {
        event: string;
        metadata?: unknown;
      };
      return yield* recordEvent(data);
    }

    // GET /files
    if (path === "/files" && method === "GET") {
      return yield* listFiles();
    }

    // POST /files
    if (path === "/files" && method === "POST") {
      const data = (yield* Effect.tryPromise(() => request.json())) as {
        key: string;
        content: string;
      };
      return yield* uploadFile(data);
    }

    // POST /tasks
    if (path === "/tasks" && method === "POST") {
      const data = (yield* Effect.tryPromise(() => request.json())) as {
        type: "process" | "analyze" | "cleanup";
        data: unknown;
      };
      return yield* queueTask(data);
    }

    // 404
    return Response.json({ error: "Not found" }, { status: 404 });
  });

// ── Worker Export ──────────────────────────────────────────────────────────

// ── Logger Configuration ───────────────────────────────────────────────────

/**
 * Pretty logger with colors for development
 * Combines console JSON for structured logs and pretty console for human-readable output
 */
const loggerLayer = Logger.layer([
  Logger.consolePretty({ colors: true }),
  Logger.formatStructured,
]);

/**
 * Set minimum log level to Debug to capture all logs
 */
const debugLogLevel = Layer.succeed(References.MinimumLogLevel, "Debug");

export default serve(handler, (env: Env, _ctx) => {
  return Layer.mergeAll(
    KV.layer(env.CACHE_KV, CacheValue),
    D1.layer(env.ANALYTICS_DB),
    R2.layer(env.CONTENT_STORAGE),
    QueueProducer.json(TaskMessage).layer(env.TASKS_QUEUE),
    loggerLayer,
    debugLogLevel
  );
});
