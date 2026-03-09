# effectful-cloudflare — Project Plan

> Effect v4 services for Cloudflare Workers infrastructure.
> Successor to `effect-cf` (v3), rebuilt from scratch for Effect v4 with improved DX, type safety, and extensibility.

---

## Table of Contents

1. [Philosophy & Goals](#1-philosophy--goals)
2. [Architecture Overview](#2-architecture-overview)
3. [Package Structure](#3-package-structure)
4. [Core Module](#4-core-module)
5. [Service Design Pattern](#5-service-design-pattern)
6. [Multi-Instance / Factory Pattern](#6-multi-instance--factory-pattern)
7. [Error Design](#7-error-design)
8. [Schema Integration](#8-schema-integration)
9. [Worker Entrypoint](#9-worker-entrypoint)
10. [Module Catalog](#10-module-catalog)
11. [Testing Strategy](#11-testing-strategy)
12. [Implementation Phases](#12-implementation-phases)
13. [Differences from effect-cf](#13-differences-from-effect-cf)

---

## 1. Philosophy & Goals

### Core Principles

1. **Effect v4 idiomatic** — `ServiceMap.Service`, `Effect.fn`, `Schema.TaggedErrorClass`, `LayerMap`, `Result` — no v3 patterns whatsoever.
2. **Type-safe bindings** — CF bindings are never `unknown`. Each service declares a minimal structural type (`*Binding`) using `Pick<>` from `@cloudflare/workers-types`.
3. **Schema-first data** — Every service that touches user data (KV values, D1 rows, Queue messages) offers schema-validated variants by default, not as an afterthought.
4. **Composable layers** — Single-instance via `ServiceMap.Service`, multi-instance via `LayerMap.Service`. No workaround patterns.
5. **Traceable** — All service methods use `Effect.fn` for automatic spans and stack traces.
6. **In-box tagged errors** — Every module exports precise tagged errors with `Schema.TaggedErrorClass` (serializable) or `Data.TaggedError` (internal). No string-based errors.
7. **Zero overhead** — Use bindings directly (in-process), never REST APIs where bindings exist.
8. **Test-friendly** — Every module exports a `*Binding` structural type and the testing module provides in-memory implementations.

### Non-Goals

- We do NOT wrap networking/security products (WAF, DDoS, Tunnel, etc.) — those are infra-level, not runtime APIs.
- We do NOT provide a framework (routing, middleware) — use Hono, itty-router, or raw fetch handlers.
- We do NOT auto-generate layers — explicit `Layer.effect(this)(this.make)` is the v4 way.

---

## 2. Architecture Overview

```
effectful-cloudflare/
├── src/
│   ├── index.ts                    # Barrel: re-exports all modules as namespaces
│   ├── Errors.ts                   # Shared error types
│   ├── Worker.ts                   # Worker entrypoint (serve, onSchedule, waitUntil)
│   │
│   ├── KV.ts                       # Workers KV
│   ├── D1.ts                       # D1 Database
│   ├── R2.ts                       # R2 Object Storage
│   ├── Queue.ts                    # Queues (producer + consumer)
│   ├── DurableObject.ts            # Durable Objects (client + server + storage)
│   ├── Cache.ts                    # Cache API
│   ├── AI.ts                       # Workers AI
│   ├── AIGateway.ts                # AI Gateway
│   ├── Vectorize.ts                # Vectorize
│   ├── Hyperdrive.ts               # Hyperdrive
│   ├── Browser.ts                  # Browser Rendering
│   ├── Pipeline.ts                 # Pipelines (R2 streaming ETL)
│   │
│   └── Testing.ts                  # In-memory mocks for all services
│
├── docs/
│   ├── PROJECT_PLAN.md             # This document
│   └── guides/                     # Migration guides, best practices
│
├── test/                           # Tests (vitest)
├── package.json
└── tsconfig.json
```

### Single-package design

Unlike monorepos, we ship a single `effectful-cloudflare` package with subpath exports:

```json
{
  "exports": {
    ".":                 "./src/index.ts",
    "./KV":              "./src/KV.ts",
    "./D1":              "./src/D1.ts",
    "./R2":              "./src/R2.ts",
    "./Queue":           "./src/Queue.ts",
    "./DurableObject":   "./src/DurableObject.ts",
    "./Cache":           "./src/Cache.ts",
    "./AI":              "./src/AI.ts",
    "./AIGateway":       "./src/AIGateway.ts",
    "./Vectorize":       "./src/Vectorize.ts",
    "./Hyperdrive":      "./src/Hyperdrive.ts",
    "./Worker":          "./src/Worker.ts",
    "./Browser":         "./src/Browser.ts",
    "./Pipeline":        "./src/Pipeline.ts",
    "./Errors":          "./src/Errors.ts",
    "./Testing":         "./src/Testing.ts"
  }
}
```

Users import like:
```ts
import { KV } from "effectful-cloudflare/KV"
import { D1 } from "effectful-cloudflare/D1"
```

Or from the barrel:
```ts
import { KV, D1, R2 } from "effectful-cloudflare"
```

---

## 3. Package Structure

### Dependencies

```json
{
  "peerDependencies": {
    "effect": "^4.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.x",
    "@cloudflare/vitest-pool-workers": "^3.x",
    "vitest": "^3.x",
    "typescript": "^5.9",
    "tsup": "^8.x"
  }
}
```

- `effect` is a peer dependency — users bring their own v4.
- `@cloudflare/workers-types` is dev-only — we extract structural types via `Pick<>` so users don't need to install it if they use wrangler-generated types.

### Build

- **tsup** for bundling (ESM only, with `.d.ts` generation).
- Target: `es2022` (Workers runtime supports it).
- No CJS — Workers are ESM-only.

---

## 4. Core Module

### `src/Errors.ts` — Shared Error Types

We define a small set of **reusable** error types. Modules can extend these or define their own.

```ts
import { Data, Schema } from "effect"

// ── Internal errors (no schema, not serializable) ──────────────────────

/** Binding not available at runtime */
export class BindingError extends Data.TaggedError("BindingError")<{
  readonly service: string
  readonly message: string
}> {}

// ── Domain errors (schema-validated, serializable) ─────────────────────

/** Schema decode/encode failed */
export class SchemaError extends Schema.TaggedErrorClass<SchemaError>()(
  "SchemaError",
  {
    message: Schema.String,
    cause: Schema.Defect,
  }
) {}

/** Resource not found */
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  {
    resource: Schema.String,
    key: Schema.String,
  },
  { httpApiStatus: 404 }
) {}
```

### Design decisions:

1. **`BindingError`** uses `Data.TaggedError` — it's internal infrastructure, never serialized.
2. **`SchemaError`** uses `Schema.TaggedErrorClass` — it's a domain error users may want to serialize (e.g., in API responses). Used consistently across all modules for schema decode/encode failures.
3. **`NotFoundError`** uses `Schema.TaggedErrorClass` — useful for HTTP 404 responses, serializable. Includes `httpApiStatus: 404`.
4. Each module adds module-specific errors (e.g., `D1QueryError`, `R2Error`) that complement these. Module errors wrap native CF exceptions with `cause?: unknown` (optional) and always include `message: string`.

---

## 5. Service Design Pattern

Every service follows this canonical v4 pattern:

```ts
// ── src/KV.ts ──────────────────────────────────────────────────────────

import { Effect, Layer, Schema, ServiceMap, Scope } from "effect"
import * as Errors from "./Errors.js"

// ── Binding type ───────────────────────────────────────────────────────

/** Minimal structural type for KVNamespace. Allows testing with mocks. */
export type KVBinding = {
  get(key: string, options?: { type?: string; cacheTtl?: number }): Promise<string | null>
  getWithMetadata<M = unknown>(key: string, options?: { type?: string; cacheTtl?: number }): Promise<{ value: string | null; metadata: M | null }>
  put(key: string, value: string, options?: { expiration?: number; expirationTtl?: number; metadata?: unknown }): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult>
}

// ── Errors ──────────────────────────────────────────────────────────────

export class KVError extends Data.TaggedError("KVError")<{
  readonly operation: string
  readonly key?: string
  readonly cause: unknown
}> {}

// ── Service definition ─────────────────────────────────────────────────

export class KV extends ServiceMap.Service<KV, {
  readonly get: (key: string) => Effect.Effect<string | null, KVError>
  readonly getOrFail: (key: string) => Effect.Effect<string, KVError | Errors.NotFoundError>
  readonly put: (key: string, value: string, options?: KVPutOptions) => Effect.Effect<void, KVError>
  readonly delete: (key: string) => Effect.Effect<void, KVError>
  readonly list: (options?: KVListOptions) => Effect.Effect<KVListResult, KVError>
}>()(
  "effectful-cloudflare/KV"
) {
  /** Create a KV service from a binding */
  static make = (binding: KVBinding) => Effect.gen(function*() {
    const get = Effect.fn("KV.get")(function*(key: string) {
      return yield* Effect.tryPromise({
        try: () => binding.get(key),
        catch: (cause) => new KVError({ operation: "get", key, cause }),
      })
    })

    const getOrFail = Effect.fn("KV.getOrFail")(function*(key: string) {
      const value = yield* get(key)
      if (value === null) {
        return yield* new Errors.NotFoundError({ resource: "KV", key })
      }
      return value
    })

    const put = Effect.fn("KV.put")(function*(key: string, value: string, options?: KVPutOptions) {
      return yield* Effect.tryPromise({
        try: () => binding.put(key, value, options),
        catch: (cause) => new KVError({ operation: "put", key, cause }),
      })
    })

    // ... delete, list similarly

    return KV.of({ get, getOrFail, put, delete: del, list })
  })

  /** Layer from a binding */
  static layer = (binding: KVBinding) =>
    Layer.effect(this)(this.make(binding))

  /** Create KV with built-in JSON + optional schema validation */
  static make(binding: KVBinding): Effect<Shape>
  static make<A>(binding: KVBinding, schema: PureSchema<A>): Effect<Shape>
  static make<A = unknown>(binding: KVBinding, schema?: PureSchema<A>) {
    // All values are JSON serialized/deserialized automatically.
    // With schema: values are encoded/decoded via Schema + validated.
  }

  static layer(binding: KVBinding): Layer<KV>
  static layer<A>(binding: KVBinding, schema: PureSchema<A>): Layer<KV>
}
```

### Key design decisions:

1. **`ServiceMap.Service<Self, Shape>()(id)`** — Explicit shape, clear API contract.
2. **`static make`** — Returns `Effect<Shape>`. Takes binding as argument (not from context). Can use `acquireRelease` for services needing cleanup.
3. **`static layer`** — Simple wrapper: `Layer.effect(this)(this.make(binding))`.
4. **`Effect.fn("KV.get")`** — Every method gets automatic tracing spans.
5. **Binding is required** — No optional binding. If you don't have the binding, don't construct the service. This avoids runtime surprises (effect-cf's optional binding pattern leads to confusing `BindingError` at call time).
6. **Built-in JSON** — All values are automatically JSON serialized/deserialized. Optional schema parameter for type safety: `KV.make(binding, schema)`, `KV.layer(binding, schema)`.

---

## 6. Multi-Instance / Factory Pattern

This is a major improvement over effect-cf. Using `LayerMap.Service` from Effect v4:

```ts
// ── Multiple KV namespaces via LayerMap ────────────────────────────────

import { LayerMap } from "effect"

// Option A: Dynamic lookup (bindings resolved at runtime)
class KVMap extends LayerMap.Service<KVMap>()("effectful-cloudflare/KVMap", {
  lookup: (name: string) =>
    Layer.effect(KV)(
      Effect.gen(function*() {
        const env = yield* WorkerEnv  // get env from context
        const binding = env[name] as KVBinding
        return yield* KV.make(binding)
      })
    ),
  idleTimeToLive: "5 minutes",
}) {}

// Usage:
const program = Effect.gen(function*() {
  const users = yield* KV.use((kv) => kv.get("user:123")).pipe(
    Effect.provide(KVMap.get("KV_USERS"))
  )
  const cache = yield* KV.use((kv) => kv.get("cache:key")).pipe(
    Effect.provide(KVMap.get("KV_CACHE"))
  )
})

// Option B: Static map (known at build time)
class KVMap extends LayerMap.Service<KVMap>()("effectful-cloudflare/KVMap", {
  layers: {
    users: KV.layer(env.KV_USERS),
    cache: KV.layer(env.KV_CACHE),
  },
}) {}
```

### When to use what:

| Pattern | Use case |
|---------|----------|
| `KV.make(binding)` | Direct use, no DI needed |
| `KV.layer(binding)` | Single instance in context |
| `KVMap` (LayerMap) | Multiple named instances, dynamically resolved |

---

## 7. Error Design

### Error hierarchy per module

Each module follows this pattern:

```
Errors (shared)
├── BindingError        — binding not available (Data.TaggedError, internal)
├── SchemaError         — decode/encode failed (Schema.TaggedErrorClass, serializable)
└── NotFoundError       — resource missing (Schema.TaggedErrorClass, serializable)

KV (module-specific)
└── KVError             — KV operation failed (wraps CF errors)
    (schema errors → SchemaError via get/getOrFail/getWithMetadata/put)

D1 (module-specific)
├── D1Error             — general D1 error
├── D1QueryError        — query failed (includes SQL + params)
└── D1MigrationError    — migration failed

R2 (module-specific)
├── R2Error             — object operation failed
├── R2MultipartError    — multipart upload failed
└── R2PresignError      — presigned URL generation failed

DurableObject (module-specific)
├── DOError             — client-side DO error
├── StorageError        — DO storage operation failed
├── AlarmError          — alarm operation failed
├── SqlError            — DO SQLite query failed
└── WebSocketError      — WebSocket operation failed
    (fetchJson schema errors → SchemaError)

Queue (module-specific)
├── QueueSendError      — send/sendBatch failed
└── QueueConsumerError  — consumer handler failed

AI (module-specific)
└── AIError             — AI inference failed

AIGateway (module-specific)
├── AIGatewayRequestError  — gateway request failed
└── AIGatewayResponseError — provider returned error response

Vectorize (module-specific)
└── VectorizeError      — vectorize operation failed
```

### Error type discrimination

```ts
Effect.gen(function*() {
  const value = yield* kv.getOrFail("missing-key")
}).pipe(
  Effect.catchTag("NotFoundError", (e) =>
    Effect.succeed(`Key ${e.key} not found in ${e.resource}`)
  ),
  Effect.catchTag("KVError", (e) =>
    Effect.succeed(`KV operation ${e.operation} failed: ${e.cause}`)
  ),
  Effect.catchTag("SchemaError", (e) =>
    Effect.succeed(`Validation failed: ${e.message}`)
  ),
)
```

### Error conventions

1. Every error has `_tag` for `Effect.catchTag`.
2. Module-specific errors include `operation` field for tracing which method failed.
3. All module-specific errors include a `message: string` field with a human-readable description.
4. Errors wrapping CF exceptions include `cause?: unknown` (optional).
5. Key/identifier fields are included where applicable for debugging.
6. `Schema.TaggedErrorClass` for errors that may cross serialization boundaries (API responses, RPC).
7. `Data.TaggedError` for internal infrastructure errors.
8. Schema decode/encode failures use shared `SchemaError` (not module-specific errors) for consistency.

---

## 8. Schema Integration

### KV with schema validation

```ts
const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})
type User = typeof UserSchema.Type

// Untyped — values are `unknown`, auto JSON
const untypedLayer = KV.layer(env.KV_DATA)

// Typed with schema — values are fully typed
const typedLayer = KV.layer(env.KV_USERS, UserSchema)

// Usage — fully typed, zero `as any` casts
const program = Effect.gen(function*() {
  const kv = yield* KV
  const user = yield* kv.getOrFail("user:123")  // decoded via schema
  yield* kv.put("user:456", { id: "456", name: "Bob", email: "bob@x.com" })  // encoded via schema
}).pipe(Effect.provide(typedLayer))
```

### D1 with schema (row validation)

```ts
const UserRow = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.String,
  created_at: Schema.String,
})

const program = Effect.gen(function*() {
  const db = yield* D1
  const users = yield* db.query(UserRow, "SELECT * FROM users WHERE active = ?", [1])
  // users: ReadonlyArray<{ id: number; name: string; email: string; created_at: string }>
})
```

### Queue with schema (message validation)

```ts
const TaskMessage = Schema.Struct({
  type: Schema.Literal("process"),
  payload: Schema.Struct({ id: Schema.String }),
})

const program = Effect.gen(function*() {
  const queue = yield* Queue
  yield* queue.send(TaskMessage, { type: "process", payload: { id: "123" } })
})
```

### Design decisions

1. **Schema is always optional** — Every service works without schema. Schema validation is an opt-in parameter (e.g., `KV.make(binding, schema)`), not a separate factory.
2. **Built-in JSON for KV** — KV always serializes/deserializes JSON automatically. Without schema, values are `unknown`. With schema, values are fully typed.
3. **No `.json()` factories** — Schema is a parameter to `make`/`layer`, not a separate factory. This eliminates type-unsafe casts (`as any`, `as unknown as`).
4. **R2 stays binary** — R2 is object storage for files/blobs. No JSON mode — users who need JSON can use `JSON.stringify`/`JSON.parse` directly.
5. **Decode on read, encode on write** — Schema validation happens at the boundary, not internally.
6. **Use `Schema.decodeUnknownSync`/`Schema.encodeSync`** — KV uses sync schema operations via `PureSchema<A>` constraint (requires `DecodingServices: never`, `EncodingServices: never`).

---

## 9. Worker Entrypoint

### `src/Worker.ts`

```ts
import { Effect, Layer, ServiceMap, Scope } from "effect"

// ── Env service ────────────────────────────────────────────────────────

/** The worker env (bindings) as an Effect service */
export class WorkerEnv<E = Record<string, unknown>>
  extends ServiceMap.Service<WorkerEnv<E>, E>()(
    "effectful-cloudflare/WorkerEnv"
  ) {}

// ── ExecutionContext service ───────────────────────────────────────────

export class ExecutionCtx extends ServiceMap.Service<ExecutionCtx, {
  readonly waitUntil: (effect: Effect.Effect<void, never>) => Effect.Effect<void>
  readonly passThroughOnException: () => Effect.Effect<void>
}>()(
  "effectful-cloudflare/ExecutionCtx"
) {
  static make = (ctx: ExecutionContext) => Effect.succeed(
    ExecutionCtx.of({
      waitUntil: (effect) => Effect.sync(() => ctx.waitUntil(Effect.runPromise(effect))),
      passThroughOnException: () => Effect.sync(() => ctx.passThroughOnException()),
    })
  )
  static layer = (ctx: ExecutionContext) => Layer.effect(this)(this.make(ctx))
}

// ── serve() ────────────────────────────────────────────────────────────

/**
 * Create a CF Worker fetch handler from an Effect program.
 *
 * ```ts
 * export default Worker.serve(
 *   Effect.gen(function*() {
 *     const kv = yield* KV
 *     const value = yield* kv.get("key")
 *     return new Response(value)
 *   }),
 *   (env, ctx) => Layer.mergeAll(
 *     KV.layer(env.KV_BINDING),
 *     ExecutionCtx.layer(ctx),
 *   )
 * )
 * ```
 */
export const serve = <E, R>(
  handler: (request: Request) => Effect.Effect<Response, E, R>,
  layers: (env: Record<string, unknown>, ctx: ExecutionContext) => Layer.Layer<R>,
): ExportedHandler => ({
  fetch: async (request, env, ctx) => {
    const layer = layers(env, ctx)
    return Effect.runPromise(
      handler(request).pipe(
        Effect.provide(layer),
        Effect.catchAllCause((cause) =>
          Effect.succeed(new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }))
        ),
      )
    )
  },
})

/**
 * Create a CF Worker scheduled handler from an Effect program.
 */
export const onScheduled = <E, R>(
  handler: (controller: ScheduledController) => Effect.Effect<void, E, R>,
  layers: (env: Record<string, unknown>, ctx: ExecutionContext) => Layer.Layer<R>,
): Pick<ExportedHandler, "scheduled"> => ({
  scheduled: async (controller, env, ctx) => {
    const layer = layers(env, ctx)
    await Effect.runPromise(
      handler(controller).pipe(Effect.provide(layer)),
    )
  },
})

/**
 * Create a CF Worker queue handler from an Effect program.
 */
export const onQueue = <T, E, R>(
  handler: (batch: MessageBatch<T>) => Effect.Effect<void, E, R>,
  layers: (env: Record<string, unknown>, ctx: ExecutionContext) => Layer.Layer<R>,
): Pick<ExportedHandler, "queue"> => ({
  queue: async (batch, env, ctx) => {
    const layer = layers(env, ctx)
    await Effect.runPromise(
      handler(batch).pipe(Effect.provide(layer)),
    )
  },
})
```

### Usage in a worker

```ts
// src/index.ts (worker entrypoint)
import { Effect, Layer } from "effect"
import { Worker, KV, D1, Queue } from "effectful-cloudflare"

export default Worker.serve(
  (request) => Effect.gen(function*() {
    const kv = yield* KV
    const value = yield* kv.get("hello")
    return new Response(value ?? "not found")
  }),
  (env, ctx) => Layer.mergeAll(
    KV.layer(env.MY_KV as KVBinding),
    Worker.ExecutionCtx.layer(ctx),
  )
)
```

---

## 10. Module Catalog

### Tier 1 — Core (implement first)

| Module | CF Binding | Description |
|--------|-----------|-------------|
| `Worker` | `ExecutionContext` | Entrypoint helpers: `serve`, `onScheduled`, `onQueue`, `ExecutionCtx` service, `WorkerEnv` service |
| `KV` | `KVNamespace` | Key-value store. Text + JSON (schema) modes. `get`, `getOrFail`, `getWithMetadata`, `put`, `delete`, `list` |
| `D1` | `D1Database` | SQL database. `query`, `queryFirst`, `queryFirstOrFail`, `batch`, `exec`, `migrate`. Schema-validated query variants |
| `R2` | `R2Bucket` | Object storage. `get`, `getOrFail`, `put`, `delete`, `head`, `list`, multipart uploads, presigned URLs |
| `Queue` | `Queue` | Message queues. `send`, `sendBatch`. Consumer handler with schema validation |
| `Errors` | — | Shared error types |

### Tier 2 — Extended (implement second)

| Module | CF Binding | Description |
|--------|-----------|-------------|
| `DurableObject` | `DurableObjectNamespace` | Client: `stub`, `fetch`, `fetchJson`. Server: `EffectDurableObject` base class with Effect lifecycle. Storage: Effect-wrapped KV + SQLite |
| `Cache` | `Cache` | Cache API. `match`, `put`, `delete` |
| `Vectorize` | `VectorizeIndex` | Vector DB. `insert`, `upsert`, `query`, `getByIds`, `deleteByIds`, `describe` |
| `Hyperdrive` | `Hyperdrive` | Connection pooling. `connectionString`, `connectionInfo` |

### Tier 3 — AI & Advanced (implement third)

| Module | CF Binding | Description |
|--------|-----------|-------------|
| `AI` | `Ai` | Workers AI. `run` with model selection, streaming support, schema-validated responses |
| `AIGateway` | `AIGateway` | AI Gateway proxy. Multi-provider routing with `run`, `universal`, logging |
| `Browser` | `BrowserWorker` | Browser rendering. Puppeteer-like API wrapped in Effect |
| `Pipeline` | `Pipeline` | Streaming ETL to R2 |

### Tier 4 — Testing

| Module | Description |
|--------|-------------|
| `Testing` | In-memory implementations of all `*Binding` types. Memory KV, D1, R2, Cache, Queue. Miniflare integration helpers |

---

## 11. Testing Strategy

### Unit tests with in-memory mocks

```ts
import { KV, Testing } from "effectful-cloudflare"
import { Effect, Layer } from "effect"
import { describe, it, expect } from "vitest"

describe("KV", () => {
  const TestKV = KV.layer(Testing.memoryKV())

  it("get/put roundtrip", () =>
    Effect.gen(function*() {
      const kv = yield* KV
      yield* kv.put("key", "value")
      const result = yield* kv.get("key")
      expect(result).toBe("value")
    }).pipe(
      Effect.provide(TestKV),
      Effect.runPromise,
    )
  )

  it("getOrFail on missing key", () =>
    Effect.gen(function*() {
      const kv = yield* KV
      const result = yield* kv.getOrFail("missing").pipe(
        Effect.result,
      )
      expect(Result.isFailure(result)).toBe(true)
    }).pipe(
      Effect.provide(TestKV),
      Effect.runPromise,
    )
  )
})
```

### Integration tests with miniflare

```ts
import { Testing } from "effectful-cloudflare"

const env = await Testing.miniflare({ kv: ["MY_KV"], d1: ["DB"] })

afterAll(() => env.dispose())

it("works with real KV", async () => {
  const binding = await env.kv("MY_KV")
  await Effect.gen(function*() {
    const kv = yield* KV
    yield* kv.put("test", "hello")
    expect(yield* kv.get("test")).toBe("hello")
  }).pipe(
    Effect.provide(KV.layer(binding)),
    Effect.runPromise,
  )
})
```

### Test helpers

```ts
// Testing module exports
export const memoryKV: () => KVBinding
export const memoryD1: () => D1Binding
export const memoryR2: () => R2Binding
export const memoryCache: () => CacheBinding
export const memoryQueue: () => QueueBinding & { messages: Array<unknown> }  // inspect sent messages
export const miniflare: (options: MiniflareOptions) => Promise<MiniflareEnv>
```

---

## 12. Implementation Phases

### Phase 1: Foundation

- [ ] Project setup (package.json, tsconfig, tsup, vitest)
- [ ] `src/Errors.ts` — shared error types
- [ ] `src/Worker.ts` — entrypoint helpers (`serve`, `onScheduled`, `ExecutionCtx`)
- [ ] `src/KV.ts` — full KV service (built-in JSON + optional schema + LayerMap)
- [ ] `src/Testing.ts` — `memoryKV` in-memory mock
- [ ] Tests for KV

### Phase 2: Storage Services

- [ ] `src/D1.ts` — D1 service with schema queries + migrations
- [ ] `src/R2.ts` — R2 service with multipart + presigned URLs
- [ ] `src/Queue.ts` — Queue producer + consumer + schema messages
- [ ] `src/Cache.ts` — Cache API service
- [ ] In-memory mocks for all above
- [ ] Tests

### Phase 3: Durable Objects

- [ ] `src/DurableObject.ts` — Client service, server base class, storage wrapper
- [ ] DO SQLite storage wrapper
- [ ] DO alarm support
- [ ] DO WebSocket support
- [ ] Tests with miniflare

### Phase 4: AI & Extras

- [ ] `src/AI.ts` — Workers AI
- [ ] `src/AIGateway.ts` — AI Gateway
- [ ] `src/Vectorize.ts` — Vectorize
- [ ] `src/Hyperdrive.ts` — Hyperdrive
- [ ] `src/Browser.ts` — Browser Rendering
- [ ] Tests

### Phase 5: Polish

- [ ] API documentation (TSDoc on all exports)
- [ ] README with examples
- [ ] CI/CD setup
- [ ] npm publish configuration
- [ ] Example worker project

---

## 13. Differences from effect-cf

### What we improve

| Aspect | effect-cf (v3) | effectful-cloudflare (v4) |
|--------|---------------|--------------------------|
| **Effect version** | v3 (`Context.Tag`, `@effect/schema`) | v4 (`ServiceMap.Service`, `Schema` from `effect`) |
| **Multi-instance** | Not supported (single tag per service) | `LayerMap.Service` for named instances |
| **Binding handling** | Optional (fails at call time) | Required at construction (fails at build time) |
| **Tracing** | None | `Effect.fn` on every method (auto-spans) |
| **Error types** | `Data.TaggedError` only, some duplicated across modules | `Schema.TaggedErrorClass` for domain errors, `Data.TaggedError` for infra, no duplication |
| **Schema integration** | Opt-in per module, inconsistent API | Built-in JSON serialization with optional schema parameter: `KV.make(binding, schema)` |
| **Layer construction** | `Layer.succeed` (no lifecycle) | `Layer.effect` (supports acquireRelease for cleanup) |
| **Service accessors** | `Effect.serviceFunctions` exports | `Service.use()` pattern (v4 idiomatic) |
| **Generator functions** | Plain `Effect.gen` | `Effect.fn` with auto-tracing |
| **Testing** | Basic memory mocks | Comprehensive mocks + miniflare helpers |
| **Workers AI** | Not supported | Full Workers AI service |
| **Browser Rendering** | Not supported | Browser Rendering service |
| **Pipelines** | Not supported | Pipeline service |
| **Worker entrypoint** | Basic `serve`/`onSchedule` | Full `serve`/`onScheduled`/`onQueue` with typed env + layer factory |
| **Error locality** | Some modules duplicate core errors | Clean hierarchy, no duplication |
| **Codec utilities** | Custom `jsonCodec` in core | Use `Schema.fromJsonString` (built-in v4) |

### What we keep from effect-cf

1. **Module-per-service** organization
2. **Structural binding types** (`*Binding` with `Pick<>`)
3. **`get` / `getOrFail` dual** for nullable results
4. **In-memory test mocks** concept
5. **R2 presigned URL** generation (AWS Sig V4)
6. **D1 migrations** runner
7. **DO server base class** concept

### What we drop from effect-cf

1. **Optional bindings** — binding is always required; fail fast
2. **`*Like` naming** — we use `*Binding` (clearer intent)
3. **Core `codec.ts`** — v4 Schema handles JSON encoding natively
4. **Core `schema.ts` helpers** — v4 Schema API is sufficient
5. **Separate `types.ts` files** — types live in the module file (less fragmentation)
6. **R2 REST API** (`buckets-api.ts`) — bucket management is a Wrangler CLI concern, not runtime
7. **Duplicated error types** — each error is defined once

---

## Appendix A: Naming Conventions

| Convention | Example |
|-----------|---------|
| Service class | `KV`, `D1`, `R2`, `Queue` (PascalCase, short) |
| Service identifier | `"effectful-cloudflare/KV"` |
| Binding type | `KVBinding`, `D1Binding` |
| Error class | `KVError`, `D1QueryError` |
| Module file | `KV.ts`, `D1.ts` |
| Layer static | `KV.layer(binding)` |
| Make static | `KV.make(binding)` |
| Schema variant | `KV.make(binding, schema)` / `KV.layer(binding, schema)` |
| LayerMap class | `KVMap` |
| Test mock | `Testing.memoryKV()` |

## Appendix B: Full KV API Surface (Reference Design)

```ts
// ── KV service shape (always JSON, values are `unknown`) ───────────────
//
// All values are automatically JSON serialized on write and deserialized on read.
// When used with a schema via KV.make(binding, schema), values are validated
// at the boundary — but the service shape uses `unknown` to support both modes
// under the same tag.

interface KVShape {
  readonly get: (key: string, options?: KVGetOptions) => Effect<unknown, KVError>
  readonly getOrFail: (key: string, options?: KVGetOptions) => Effect<unknown, KVError | NotFoundError>
  readonly getWithMetadata: <M = unknown>(key: string, options?: KVGetOptions) => Effect<KVValueWithMetadata<unknown, M>, KVError>
  readonly put: (key: string, value: unknown, options?: KVPutOptions) => Effect<void, KVError>
  readonly delete: (key: string) => Effect<void, KVError>
  readonly list: (options?: KVListOptions) => Effect<KVListResult, KVError>
}

// ── Options types ──────────────────────────────────────────────────────

interface KVGetOptions {
  readonly cacheTtl?: number
}

interface KVPutOptions {
  readonly expiration?: number
  readonly expirationTtl?: number
  readonly metadata?: unknown
}

interface KVListOptions {
  readonly prefix?: string
  readonly limit?: number
  readonly cursor?: string
}

// ── Result types ───────────────────────────────────────────────────────

interface KVValueWithMetadata<V, M> {
  readonly value: V
  readonly metadata: M | null
}

interface KVListResult {
  readonly keys: ReadonlyArray<{ name: string; expiration?: number; metadata?: unknown }>
  readonly list_complete: boolean
  readonly cursor?: string
}
```

## Appendix C: D1 API Surface (Reference Design)

```ts
interface D1Shape {
  /** Execute a query, return all rows (untyped) */
  readonly query: <T = Record<string, unknown>>(sql: string, ...params: ReadonlyArray<unknown>) => Effect<ReadonlyArray<T>, D1Error>

  /** Execute a query with schema validation on each row */
  readonly querySchema: <A, I>(schema: Schema<A, I>, sql: string, ...params: ReadonlyArray<unknown>) => Effect<ReadonlyArray<A>, D1Error | SchemaError>

  /** Return first row or null */
  readonly queryFirst: <T = Record<string, unknown>>(sql: string, ...params: ReadonlyArray<unknown>) => Effect<T | null, D1Error>

  /** Return first row or fail with NotFoundError */
  readonly queryFirstOrFail: <T = Record<string, unknown>>(sql: string, ...params: ReadonlyArray<unknown>) => Effect<T, D1Error | NotFoundError>

  /** Return first row, schema-validated */
  readonly queryFirstSchema: <A, I>(schema: Schema<A, I>, sql: string, ...params: ReadonlyArray<unknown>) => Effect<A | null, D1Error | SchemaError>

  /** Batch multiple statements atomically */
  readonly batch: (statements: ReadonlyArray<D1PreparedStatement>) => Effect<ReadonlyArray<D1Result>, D1Error>

  /** Execute raw SQL (multiple statements) */
  readonly exec: (sql: string) => Effect<D1ExecResult, D1Error>

  /** Run migrations */
  readonly migrate: (migrations: ReadonlyArray<Migration>) => Effect<void, D1MigrationError>
}
```

## Appendix D: R2 API Surface (Reference Design)

```ts
interface R2Shape {
  readonly get: (key: string, options?: R2GetOptions) => Effect<R2Object | null, R2Error>
  readonly getOrFail: (key: string, options?: R2GetOptions) => Effect<R2Object, R2Error | NotFoundError>
  readonly put: (key: string, value: R2PutValue, options?: R2PutOptions) => Effect<R2ObjectInfo, R2Error>
  readonly delete: (key: string | ReadonlyArray<string>) => Effect<void, R2Error>
  readonly head: (key: string) => Effect<R2ObjectInfo | null, R2Error>
  readonly list: (options?: R2ListOptions) => Effect<R2ListResult, R2Error>

  // Multipart uploads
  readonly createMultipartUpload: (key: string, options?: R2MultipartOptions) => Effect<R2MultipartUpload, R2MultipartError>
  readonly resumeMultipartUpload: (key: string, uploadId: string) => Effect<R2MultipartUpload, R2MultipartError>

  // Presigned URLs (requires presign config)
  readonly presign: (key: string, options: R2PresignOptions) => Effect<string, R2PresignError>
}
```

## Appendix E: Queue API Surface (Reference Design)

```ts
// Producer
interface QueueProducerShape<T = unknown> {
  readonly send: (message: T, options?: QueueSendOptions) => Effect<void, QueueError>
  readonly sendBatch: (messages: ReadonlyArray<QueueBatchMessage<T>>) => Effect<void, QueueError>
}

// Consumer handler type
type QueueConsumerHandler<T, E, R> =
  (message: T, metadata: QueueMessageMetadata) => Effect<void, E, R>

// Schema-validated consumer
const consume = <A, I>(schema: Schema<A, I>) => ({
  handler: <E, R>(fn: QueueConsumerHandler<A, E, R>) => ...
})
```
