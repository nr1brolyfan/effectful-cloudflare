# effectful-cloudflare

Type-safe Effect v4 bindings for Cloudflare Workers platform services.

> **Warning:** Alpha release, depends on Effect v4 (beta). API may change before 1.0.0.

## Features

- **Effect v4 native** — `ServiceMap.Service`, `Effect.fn`, `Schema.TaggedErrorClass`, `LayerMap`
- **Type-safe bindings** — Structural types for all CF services (KV, D1, R2, Queue, DO, AI, etc.)
- **Schema-first data** — Built-in JSON serialization + optional schema validation
- **Composable layers** — Single-instance (`Layer`) + multi-instance (`LayerMap`) patterns
- **Traceable** — All methods use `Effect.fn` for automatic spans and stack traces
- **Tagged errors** — Precise error types for every operation (serializable + internal)
- **Test-friendly** — In-memory mocks for all services (`Testing` module)
- **Zero REST overhead** — Direct binding usage, no network calls

## Installation

```bash
npm install effectful-cloudflare
```

**Peer dependency:** `effect: ^4.0.0-beta`

## Bundle Size

- **Full package:** 67 KB (npm tarball)
- **Runtime usage:** ~3-10 KB gzipped (depending on imports)
- **Tree-shakeable:** Import only what you need via subpath exports

Example: `import { KV } from "effectful-cloudflare/KV"` adds ~3 KB gzipped.
The `Testing` module (7.5 KB) is only imported when explicitly needed.

## Quick Start

```ts
import { Effect, Layer } from "effect"
import { KV } from "effectful-cloudflare/KV"
import { serve } from "effectful-cloudflare/Worker"

const handler = (request: Request) => Effect.gen(function*() {
  const kv = yield* KV
  const user = yield* kv.get("user:123")
  return new Response(JSON.stringify(user))
})

export default serve(handler, (env) => KV.layer(env.MY_KV))
```

## Module Catalog

| Module | Import | Description |
|--------|--------|-------------|
| **Worker** | `effectful-cloudflare/Worker` | Worker entrypoint (`serve`, `onScheduled`, `onQueue`) |
| **KV** | `effectful-cloudflare/KV` | Workers KV (key-value store) |
| **D1** | `effectful-cloudflare/D1` | D1 SQL database (SQLite) |
| **R2** | `effectful-cloudflare/R2` | R2 object storage (S3-compatible) |
| **Queue** | `effectful-cloudflare/Queue` | Queues (producer + consumer) |
| **DurableObject** | `effectful-cloudflare/DurableObject` | Durable Objects (client + server + storage) |
| **Cache** | `effectful-cloudflare/Cache` | Cache API |
| **AI** | `effectful-cloudflare/AI` | Workers AI (inference models) |
| **AIGateway** | `effectful-cloudflare/AIGateway` | AI Gateway (multi-provider routing) |
| **Vectorize** | `effectful-cloudflare/Vectorize` | Vectorize (vector database) |
| **Hyperdrive** | `effectful-cloudflare/Hyperdrive` | Hyperdrive (connection pooling) |
| **Browser** | `effectful-cloudflare/Browser` | Browser Rendering |
| **Pipeline** | `effectful-cloudflare/Pipeline` | Pipelines (R2 streaming ETL) |
| **Errors** | `effectful-cloudflare/Errors` | Shared error types |
| **Testing** | `effectful-cloudflare/Testing` | In-memory mocks |

## Core Concepts

### Service Pattern

Every service can be used in two ways:

#### 1. Factory Pattern (direct usage, no DI)

Create the service directly from the binding and use it immediately:

```ts
import { KV } from "effectful-cloudflare/KV"

const program = Effect.gen(function*() {
  const kv = yield* KV.make(env.MY_KV)
  const value = yield* kv.get("key")
  yield* kv.put("key", { data: "value" })
})

// With schema validation:
const kv = yield* KV.make(env.MY_KV, UserSchema)
```

**Use when:** You need the service in a single place and don't need dependency injection.

#### 2. Layer Pattern (dependency injection)

Provide the service as a Layer and access it from the Effect context:

```ts
import { KV } from "effectful-cloudflare/KV"

const kvLayer = KV.layer(env.MY_KV)

const program = Effect.gen(function*() {
  const kv = yield* KV
  const value = yield* kv.get("key")
  yield* kv.put("key", { data: "value" })
}).pipe(Effect.provide(kvLayer))
```

**Use when:** You want to compose multiple services or make your code testable (swap layers for mocks).

### Schema Validation

Schema validation varies by service, applied where it makes the most sense:

#### Construction-time schema (KV, Queue, Cache)

For homogeneous stores where one namespace = one data type:

```ts
import { Schema } from "effect"
import { KV } from "effectful-cloudflare/KV"

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})

// Factory — schema as second argument
const kv = yield* KV.make(env.MY_KV, User)
yield* kv.put("user:123", { id: "123", name: "Alice", email: "a@b.com" }) // typechecked
const user = yield* kv.get("user:123") // User | null

// Layer — same API
const kvLayer = KV.layer(env.MY_KV, User)
```

Queue uses a factory method for schema:

```ts
import { QueueProducer } from "effectful-cloudflare/Queue"

const typedQueue = QueueProducer.json(TaskSchema)
const layer = typedQueue.layer(env.MY_QUEUE)
```

#### Per-call schema (D1, AI, DOClient)

For heterogeneous services where each call returns a different type:

```ts
import { D1 } from "effectful-cloudflare/D1"

const db = yield* D1
const users = yield* db.querySchema(User, "SELECT * FROM users WHERE active = ?", true)
const user = yield* db.queryFirstSchema(User, "SELECT * FROM users WHERE id = ?", 123)
```

```ts
import { AI } from "effectful-cloudflare/AI"

const ai = yield* AI
const result = yield* ai.runSchema("@cf/meta/llama-3-8b-instruct", ResponseSchema, { prompt: "..." })
```

### Multi-Instance Pattern (LayerMap)

**Problem:** Your Worker has multiple KV namespaces (`env.KV_USERS`, `env.KV_CACHE`) and you need to use different ones in different parts of your app.

**Solution:** Use `LayerMap` to dynamically resolve which binding to use by name.

```jsonc
// wrangler.jsonc
{
  "kv_namespaces": [
    { "binding": "KV_USERS", "id": "..." },
    { "binding": "KV_CACHE", "id": "..." }
  ]
}
```

The library provides built-in `KVMap`, `D1Map`, `R2Map`, and `QueueProducerMap` LayerMap services. These require `WorkerEnv` to resolve bindings by name:

```ts
import { Effect, Layer } from "effect"
import { KV, KVMap } from "effectful-cloudflare/KV"
import { WorkerEnv } from "effectful-cloudflare/Worker"

// Provide WorkerEnv + KVMap layers
const layers = Layer.mergeAll(
  WorkerEnv.layer(env),
  KVMap.layer
)

// Use different KV namespaces dynamically
const program = Effect.gen(function*() {
  // Access KV_USERS namespace
  const usersKV = yield* KV.pipe(Effect.provide(KVMap.get("KV_USERS")))
  const user = yield* usersKV.get("user:123")

  // Access KV_CACHE namespace
  const cacheKV = yield* KV.pipe(Effect.provide(KVMap.get("KV_CACHE")))
  const cached = yield* cacheKV.get("result:abc")
}).pipe(Effect.provide(layers))
```

You can also define a custom LayerMap with your own lookup logic:

```ts
class MyKVMap extends LayerMap.Service<MyKVMap>()("app/KVMap", {
  lookup: (bindingName: string) =>
    Layer.effect(KV,
      Effect.gen(function*() {
        const env = yield* WorkerEnv
        return yield* KV.make(env[bindingName] as KVBinding)
      })
    ),
  idleTimeToLive: "5 minutes",
}) {}
```

**Use LayerMap when:** Multiple bindings of the same type with different purposes, or dynamic binding selection at runtime.

**Don't use when:** One binding per service type (use `KV.layer(env.MY_KV)`) or partitioning data within one KV (use key prefixes).

### Error Handling

All services use tagged errors:

```ts
import { Effect } from "effect"
import { KV, KVError } from "effectful-cloudflare/KV"
import { NotFoundError } from "effectful-cloudflare/Errors"

const program = Effect.gen(function*() {
  const kv = yield* KV

  // Option 1: getOrFail (fails with NotFoundError)
  const user = yield* kv.getOrFail("user:123")

  // Option 2: get + null check
  const maybe = yield* kv.get("user:123")
  if (maybe === null) {
    return yield* new NotFoundError({ resource: "KV", key: "user:123" })
  }

  // Option 3: catchTag
  return yield* kv.getOrFail("user:123").pipe(
    Effect.catchTag("NotFoundError", () => Effect.succeed({ default: "user" }))
  )
})
```

## Usage Examples

### KV — Key-Value Store

```ts
import { Effect } from "effect"
import { KV } from "effectful-cloudflare/KV"

const program = Effect.gen(function*() {
  const kv = yield* KV

  yield* kv.put("user:123", { id: "123", name: "Alice" })
  const user = yield* kv.get("user:123")
  const result = yield* kv.getWithMetadata("user:123")
  const keys = yield* kv.list({ prefix: "user:" })
  yield* kv.delete("user:123")
})
```

### D1 — SQL Database

```ts
import { Schema } from "effect"
import { D1 } from "effectful-cloudflare/D1"

const User = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.String,
})

const program = Effect.gen(function*() {
  const db = yield* D1

  // Query with schema validation (per-call)
  const users = yield* db.querySchema(User, "SELECT * FROM users WHERE active = ?", true)

  // Query first row
  const user = yield* db.queryFirst("SELECT * FROM users WHERE id = ?", 123)

  // Or fail if not found
  const user2 = yield* db.queryFirstOrFail("SELECT * FROM users WHERE id = ?", 456)

  // Batch (atomic)
  const stmts = [
    db.prepare("INSERT INTO users (name) VALUES (?)", "Alice"),
    db.prepare("INSERT INTO users (name) VALUES (?)", "Bob"),
  ]
  yield* db.batch(stmts)

  // Run migrations
  yield* db.migrate([
    { name: "001_init", sql: "CREATE TABLE users ..." },
    { name: "002_add_email", sql: "ALTER TABLE users ..." },
  ])
})
```

### R2 — Object Storage

```ts
import { R2 } from "effectful-cloudflare/R2"

const program = Effect.gen(function*() {
  const r2 = yield* R2

  yield* r2.put("file.txt", "Hello, world!", {
    httpMetadata: { contentType: "text/plain" },
    customMetadata: { author: "Alice" },
  })

  const obj = yield* r2.get("file.txt")
  const obj2 = yield* r2.getOrFail("file.txt")
  const info = yield* r2.head("file.txt")
  const list = yield* r2.list({ prefix: "uploads/" })

  // Multipart upload
  const upload = yield* r2.createMultipartUpload("large.bin")
  // ... upload parts ...
  yield* upload.complete([...uploadedParts])

  yield* r2.delete("file.txt")
})
```

### Queue — Message Queue

```ts
import { Schema } from "effect"
import { QueueProducer, consume } from "effectful-cloudflare/Queue"

const Message = Schema.Struct({
  type: Schema.Literal("user.created"),
  userId: Schema.String,
})

// Producer — with schema validation via .json() factory
const program = Effect.gen(function*() {
  const queue = yield* QueueProducer
  yield* queue.send({ type: "user.created", userId: "123" })
  yield* queue.sendBatch([
    { body: { type: "user.created", userId: "123" } },
    { body: { type: "user.created", userId: "456" } },
  ])
})

// Consumer — standalone function, returns CF handler
export default {
  ...consume({ schema: Message }).handler((message, meta) =>
    Effect.gen(function*() {
      console.log("Received:", message)
    })
  ),
}
```

### Durable Objects

```ts
import { Effect } from "effect"
import { DOClient, EffectDurableObject } from "effectful-cloudflare/DurableObject"

// Server: Define DO class
export class Counter extends EffectDurableObject {
  fetch(request: Request) {
    return Effect.gen(this, function*(self) {
      const count = yield* self.storage.get("count").pipe(
        Effect.map((v) => (v as number) ?? 0)
      )
      yield* self.storage.put("count", count + 1)
      return new Response(JSON.stringify({ count: count + 1 }))
    })
  }

  alarm() {
    return Effect.gen(this, function*(self) {
      console.log("Alarm triggered!")
    })
  }
}

// Client: Call DO from worker
const program = Effect.gen(function*() {
  const client = yield* DOClient
  const stub = yield* client.stub(env.COUNTER, { type: "name", name: "global" })
  const response = yield* client.fetch(stub, new Request("https://counter/"))
  const data = yield* Effect.promise(() => response.json())
  console.log(data.count)
}).pipe(Effect.provide(DOClient.layer()))
```

### AI — Workers AI

```ts
import { Schema } from "effect"
import { AI } from "effectful-cloudflare/AI"

const Response = Schema.Struct({
  response: Schema.String,
})

const program = Effect.gen(function*() {
  const ai = yield* AI

  // Run model (untyped)
  const result = yield* ai.run("@cf/meta/llama-3-8b-instruct", {
    prompt: "What is the capital of France?",
  })

  // Run model with per-call schema validation
  const result2 = yield* ai.runSchema(
    "@cf/meta/llama-3-8b-instruct",
    Response,
    { prompt: "What is the capital of France?" }
  )
})
```

### Worker Entrypoint

```ts
import { Effect, Layer } from "effect"
import { serve, onScheduled, onQueue, ExecutionCtx } from "effectful-cloudflare/Worker"
import { KV } from "effectful-cloudflare/KV"
import { D1 } from "effectful-cloudflare/D1"

// HTTP handler
const handler = (request: Request) => Effect.gen(function*() {
  const kv = yield* KV
  const db = yield* D1
  return new Response("OK")
})

// Compose layers
const makeAppLayer = (env: Env, ctx: ExecutionContext) =>
  Layer.mergeAll(
    KV.layer(env.MY_KV),
    D1.layer(env.MY_DB),
    ExecutionCtx.layer(ctx),
  )

// Export handlers
export default {
  ...serve(handler, makeAppLayer),
  ...onScheduled((controller) => Effect.gen(function*() {
    const kv = yield* KV
    // Run scheduled task...
  }), makeAppLayer),
  ...onQueue((batch) => Effect.gen(function*() {
    const db = yield* D1
    // Process queue messages...
  }), makeAppLayer),
}
```

## Testing

All services have in-memory mocks:

```ts
import { Effect } from "effect"
import { describe, it } from "vitest"
import { KV } from "effectful-cloudflare/KV"
import { Testing } from "effectful-cloudflare/Testing"

describe("KV", () => {
  it("should get and put values", () =>
    Effect.gen(function*() {
      const kv = yield* KV
      yield* kv.put("key", { value: "test" })
      const result = yield* kv.get("key")
      expect(result).toEqual({ value: "test" })
    }).pipe(
      Effect.provide(KV.layer(Testing.memoryKV()))
    )
  )
})
```

Available mocks:

| Mock | Service |
|------|---------|
| `Testing.memoryKV()` | KV |
| `Testing.memoryD1()` | D1 |
| `Testing.memoryR2()` | R2 |
| `Testing.memoryQueue()` | QueueProducer |
| `Testing.memoryCache()` | Cache |
| `Testing.memoryDOStorage()` | Durable Object storage |
| `Testing.memoryVectorize()` | Vectorize |
| `Testing.memoryAI()` | AI |
| `Testing.memoryAIGateway()` | AIGateway |
| `Testing.memoryBrowser()` | Browser |
| `Testing.memoryPipeline()` | Pipeline |

## Error Types

### Shared Errors (`effectful-cloudflare/Errors`)

| Error | Kind | Description |
|-------|------|-------------|
| `BindingError` | `Data.TaggedError` (internal) | Binding not available in worker environment |
| `SchemaError` | `Schema.TaggedErrorClass` (serializable) | Schema encode/decode failed |
| `NotFoundError` | `Schema.TaggedErrorClass` (serializable, HTTP 404) | Resource not found |

### Module-Specific Errors

- **KV:** `KVError`
- **D1:** `D1Error`, `D1QueryError`, `D1MigrationError`
- **R2:** `R2Error`, `R2MultipartError`, `R2PresignError`
- **Queue:** `QueueSendError`, `QueueConsumerError`
- **DurableObject:** `DOError`, `StorageError`, `AlarmError`, `SqlError`, `WebSocketError`
- **Cache:** `CacheError`
- **AI:** `AIError`
- **AIGateway:** `AIGatewayRequestError`, `AIGatewayResponseError`
- **Vectorize:** `VectorizeError`
- **Hyperdrive:** `HyperdriveError`
- **Browser:** `BrowserError`
- **Pipeline:** `PipelineError`

## API Design Principles

1. **Explicit over implicit** — Services require bindings at construction. No runtime surprises.
2. **Type-safe by default** — All bindings are structurally typed. Mock-friendly.
3. **Schema-first** — JSON serialization built-in, schema validation optional.
4. **Composable** — Single-instance (`Layer`) + multi-instance (`LayerMap`) patterns.
5. **Traceable** — All methods use `Effect.fn` for automatic spans.
6. **Tagged errors** — Precise error types for every operation.
7. **Effect v4 native** — `ServiceMap`, `Effect.fn`, `LayerMap`. No v3 patterns.

## Project Structure

```
effectful-cloudflare/
├── src/
│   ├── Errors.ts          # Shared error types
│   ├── Worker.ts          # Worker entrypoint (serve, onScheduled, onQueue)
│   ├── KV.ts              # Workers KV
│   ├── D1.ts              # D1 Database
│   ├── R2.ts              # R2 Object Storage
│   ├── Queue.ts           # Queues (QueueProducer + consume/consumeEffect)
│   ├── DurableObject.ts   # Durable Objects (DOClient + EffectDurableObject)
│   ├── Cache.ts           # Cache API
│   ├── AI.ts              # Workers AI
│   ├── AIGateway.ts       # AI Gateway
│   ├── Vectorize.ts       # Vectorize
│   ├── Hyperdrive.ts      # Hyperdrive
│   ├── Browser.ts         # Browser Rendering
│   ├── Pipeline.ts        # Pipelines
│   └── Testing.ts         # In-memory mocks
├── test/
├── docs/
└── package.json
```

## Requirements

- **Effect:** `^4.0.0-beta`
- **TypeScript:** `^5.9`
- **Cloudflare Workers:** Latest (2024+)

## License

MIT

## Links

- [GitHub](https://github.com/itsbroly/effectful-cloudflare)
- [npm](https://www.npmjs.com/package/effectful-cloudflare)
- [Effect Documentation](https://effect.website)
- [Cloudflare Workers](https://workers.cloudflare.com)

## Contributing

Contributions welcome! Please open an issue or PR.

## Acknowledgments

Inspired by [`effect-cf`](https://github.com/jbt95/effect-cf)

---

## Comparison: effectful-cloudflare vs effect-cf vs distilled-cloudflare

Three Effect-based libraries for Cloudflare — each solving a different problem.

### At a Glance

| | **effectful-cloudflare** | **effect-cf** | **distilled-cloudflare** |
|--|--------------------------|---------------|--------------------------|
| **What it wraps** | Worker runtime bindings (`env.KV`, `env.DB`, etc.) | Worker runtime bindings | Cloudflare REST Management API (`api.cloudflare.com`) |
| **Runs where** | Inside a Cloudflare Worker | Inside a Cloudflare Worker | Anywhere (Node, Bun, CLI, CI) |
| **Effect version** | v4 (`ServiceMap.Service`, `LayerMap`, `Effect.fn`) | v3 (`Context.Tag`, `@effect/schema`) | v3-era (`Context.GenericTag`) |

### Service Coverage

| Service | **effectful-cloudflare** | **effect-cf** | **distilled-cloudflare** |
|---------|--------------------------|---------------|--------------------------|
| **KV** (runtime) | Yes | Yes | No (namespace mgmt via REST) |
| **D1** (SQL) | Yes | Yes | No (database mgmt via REST) |
| **R2** (objects) | Yes | Yes | No (bucket mgmt via REST) |
| **Queue** (send/consume) | Yes | Yes | No (queue mgmt via REST) |
| **Durable Objects** | Yes (client + server + storage) | Yes | No |
| **Cache API** | Yes | Yes | No |
| **Workers AI** | Yes | No | No |
| **AI Gateway** | Yes | Yes | No |
| **Vectorize** | Yes | Yes | No |
| **Hyperdrive** | Yes | Yes | No |
| **Browser Rendering** | Yes | No | No |
| **Pipelines** | Yes | No | No |
| **DNS, Pages, Zones** | No (infra-level) | No | Yes (30 admin API services) |
| **Worker entrypoint** | Yes (`serve`, `onScheduled`, `onQueue`) | Yes | No |
| **Test mocks** | Yes (11 services) | Yes | No |

### When to Use Which

| Use case | Recommended |
|----------|-------------|
| Building an app inside a Cloudflare Worker | **effectful-cloudflare** |
| Effect v3 project already using effect-cf | **effect-cf** (or migrate for v4) |
| Managing CF infrastructure from CLI/CI | **distilled-cloudflare** |
| Both runtime bindings AND admin API | **effectful-cloudflare** + **distilled-cloudflare** |
