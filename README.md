# effectful-cloudflare

Type-safe Effect v4 bindings for Cloudflare Workers platform services.

**Status:** Alpha.

## Features

- **Effect v4 native** — `ServiceMap.Service`, `Effect.fn`, `Schema.TaggedErrorClass`, `LayerMap`
- **Type-safe bindings** — Structural types for all CF services (KV, D1, R2, Queue, DO, AI, etc.)
- **Schema-first data** — Built-in JSON serialization + optional schema validation via `Schema`
- **Composable layers** — Single-instance (`Layer`) + multi-instance (`LayerMap`) patterns
- **Traceable** — All methods use `Effect.fn` for automatic spans and stack traces
- **Tagged errors** — Precise error types for every operation (serializable + internal)
- **Test-friendly** — In-memory mocks for all services (`Testing` module)
- **Zero REST overhead** — Direct binding usage, no network calls where native APIs exist

## Installation

```bash
npm install effectful-cloudflare
# or
bun add effectful-cloudflare
```

**Peer dependency:** `effect: ^4.0.0-beta`

## Quick Start

```ts
import { Effect, Layer } from "effect"
import { KV } from "effectful-cloudflare/KV"
import { Worker } from "effectful-cloudflare/Worker"

// Define your worker handler
const handler = (request: Request) => Effect.gen(function*() {
  // Access KV service from context
  const kv = yield* KV
  
  // Get value (auto-JSON parsed)
  const user = yield* kv.get("user:123")
  
  // Return Response
  return new Response(JSON.stringify(user))
})

// Export CF Worker handler
export default Worker.serve(handler, (env) => KV.layer(env.MY_KV))
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

Every service can be used in **two ways**:

#### 1. Factory Pattern (direct usage, no DI)

Create the service directly from the binding and use it immediately:

```ts
import { KV } from "effectful-cloudflare/KV"

const program = Effect.gen(function*() {
  // Create service from binding and use it directly
  const kv = yield* KV.make(env.MY_KV)
  const value = yield* kv.get("key")
  yield* kv.put("key", { data: "value" })
})
```

**Use when:** You need the service in a single place and don't need dependency injection.

#### 2. Layer Pattern (dependency injection)

Provide the service as a Layer and access it from the Effect context:

```ts
import { KV } from "effectful-cloudflare/KV"

// Create Layer from binding
const kvLayer = KV.layer(env.MY_KV)

// Access service from context
const program = Effect.gen(function*() {
  const kv = yield* KV
  const value = yield* kv.get("key")
  yield* kv.put("key", { data: "value" })
}).pipe(Effect.provide(kvLayer))
```

**Use when:** You want to compose multiple services or make your code testable (swap layers for mocks).

### Schema Validation

All data services support optional schema validation:

```ts
import { Schema } from "effect"
import { KV } from "effectful-cloudflare/KV"

// Define schema
const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})

// Create typed KV service
const kvLayer = KV.layer(env.MY_KV, User)

// Get value (auto-validated)
const program = Effect.gen(function*() {
  const kv = yield* KV
  const user = yield* kv.get("user:123") // Type: typeof User.Type | null
})
```

### Multi-Instance Pattern

**Problem:** Your Worker has **multiple KV namespaces** (e.g., `env.KV_USERS`, `env.KV_CACHE`, `env.KV_SESSIONS`) and you need to use different ones in different parts of your app.

**Solution:** Use `LayerMap` to dynamically resolve which KV namespace to use by name.

#### How it works

`LayerMap` is a **keyed resource pool**. Think of it like a `Map<string, Layer>` that creates layers on-demand:

- **Multiple KV namespaces** = Multiple **Cloudflare KV bindings** in `wrangler.jsonc`:
  ```jsonc
  {
    "kv_namespaces": [
      { "binding": "KV_USERS", "id": "..." },
      { "binding": "KV_CACHE", "id": "..." },
      { "binding": "KV_SESSIONS", "id": "..." }
    ]
  }
  ```
- Each binding is a **separate KV namespace** (isolated storage)
- `LayerMap` lets you **pick which one to use** dynamically at runtime

#### Example: Multi-tenant app with isolated KV per tenant

```ts
import { Layer, LayerMap } from "effect"
import { KV, KVMap } from "effectful-cloudflare/KV"
import { WorkerEnv } from "effectful-cloudflare/Worker"

// Define your KV namespaces in wrangler.jsonc:
// kv_namespaces: [
//   { binding: "KV_USERS", id: "..." },
//   { binding: "KV_CACHE", id: "..." }
// ]

// Create a LayerMap that looks up KV namespaces by binding name
class MyKVMap extends LayerMap.Service<MyKVMap>()("app/KVMap", {
  lookup: (bindingName: string) =>
    Layer.effect(KV)(
      Effect.gen(function*() {
        const env = yield* WorkerEnv
        // env[bindingName] = env.KV_USERS or env.KV_CACHE
        return yield* KV.make(env[bindingName])
      })
    ),
  idleTimeToLive: "5 minutes", // Cache the layer for 5 min
}) {}

// Usage: Access different KV namespaces in the same program
const program = Effect.gen(function*() {
  // Get from KV_USERS namespace
  const user = yield* KV.use((kv) => kv.get("user:123"))
    .pipe(Effect.provide(MyKVMap.get("KV_USERS")))
  
  // Get from KV_CACHE namespace
  const cached = yield* KV.use((kv) => kv.get("result:abc"))
    .pipe(Effect.provide(MyKVMap.get("KV_CACHE")))
  
  // Both use the same KV service interface, but different storage backends
})
```

#### When to use LayerMap

✅ **Use LayerMap when:**
- You have **multiple KV/D1/R2 bindings** with different purposes (users, cache, logs, etc.)
- You need to **dynamically select** which binding to use based on runtime data (tenant ID, region, etc.)
- You want to **cache layer construction** (avoid recreating services repeatedly)

❌ **Don't use LayerMap when:**
- You only have **one binding** per service type → Use simple `KV.layer(env.MY_KV)` instead
- You want to **partition data within one KV** → Use key prefixes instead (`user:123`, `cache:abc`)

### Error Handling

All services use tagged errors:

```ts
import { Effect, Match } from "effect"
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
  
  // Put JSON value (auto-serialized)
  yield* kv.put("user:123", { id: "123", name: "Alice" })
  
  // Get value (auto-deserialized)
  const user = yield* kv.get("user:123")
  
  // Get with metadata
  const result = yield* kv.getWithMetadata("user:123")
  console.log(result.value, result.metadata)
  
  // List keys by prefix
  const keys = yield* kv.list({ prefix: "user:" })
  
  // Delete
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
  
  // Query with schema validation
  const users = yield* db.querySchema(
    User,
    "SELECT * FROM users WHERE active = ?",
    true
  )
  
  // Query first row
  const user = yield* db.queryFirst(
    "SELECT * FROM users WHERE id = ?",
    123
  )
  
  // Or fail if not found
  const user2 = yield* db.queryFirstOrFail(
    "SELECT * FROM users WHERE id = ?",
    456
  )
  
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
  
  // Put object
  yield* r2.put("file.txt", "Hello, world!", {
    httpMetadata: { contentType: "text/plain" },
    customMetadata: { author: "Alice" },
  })
  
  // Get object
  const obj = yield* r2.get("file.txt")
  if (obj) {
    const text = yield* Effect.promise(() => obj.text())
    console.log(text)
  }
  
  // Or fail if not found
  const obj2 = yield* r2.getOrFail("file.txt")
  
  // Head (metadata only)
  const info = yield* r2.head("file.txt")
  
  // List objects
  const list = yield* r2.list({ prefix: "uploads/" })
  
  // Multipart upload
  const upload = yield* r2.createMultipartUpload("large.bin")
  // ... upload parts ...
  yield* upload.complete([...uploadedParts])
  
  // Delete
  yield* r2.delete("file.txt")
})
```

### Queue — Message Queue

```ts
import { Schema } from "effect"
import { Queue } from "effectful-cloudflare/Queue"

const Message = Schema.Struct({
  type: Schema.Literal("user.created"),
  userId: Schema.String,
})

// Producer
const program = Effect.gen(function*() {
  const queue = yield* Queue
  
  // Send single message (JSON)
  yield* queue.send({ type: "user.created", userId: "123" })
  
  // Send batch
  yield* queue.sendBatch([
    { body: { type: "user.created", userId: "123" } },
    { body: { type: "user.created", userId: "456" } },
  ])
})

// Consumer (in worker export)
export default {
  queue: Queue.consume({ schema: Message }).handler((message, meta) =>
    Effect.gen(function*() {
      console.log("Received:", message)
      // Process message...
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
  fetch = Effect.fn("Counter.fetch")(function*(request: Request) {
    const storage = this.storage
    
    // Get current count
    const count = yield* storage.get("count").pipe(
      Effect.map((v) => (v as number) ?? 0)
    )
    
    // Increment
    yield* storage.put("count", count + 1)
    
    return new Response(JSON.stringify({ count: count + 1 }))
  })
  
  // Optional: alarm
  alarm = Effect.fn("Counter.alarm")(function*() {
    console.log("Alarm triggered!")
  })
}

// Client: Call DO from worker
const program = Effect.gen(function*() {
  const client = yield* DOClient
  
  // Get stub
  const stub = yield* client.stub(env.COUNTER, { type: "name", name: "global" })
  
  // Fetch
  const response = yield* client.fetch(stub, new Request("https://counter/"))
  const data = yield* Effect.promise(() => response.json())
  
  console.log(data.count)
})
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
  
  // Run model with schema validation
  const result2 = yield* ai.runSchema(
    "@cf/meta/llama-3-8b-instruct",
    Response,
    { prompt: "What is the capital of France?" }
  )
  
  console.log(result2.response)
})
```

### Worker Entrypoint

```ts
import { Effect, Layer } from "effect"
import { Worker } from "effectful-cloudflare/Worker"
import { KV } from "effectful-cloudflare/KV"
import { D1 } from "effectful-cloudflare/D1"

// HTTP handler
const handler = (request: Request) => Effect.gen(function*() {
  const kv = yield* KV
  const db = yield* D1
  
  // Your business logic...
  
  return new Response("OK")
})

// Scheduled handler (cron)
const scheduled = (controller: ScheduledController) => Effect.gen(function*() {
  const kv = yield* KV
  // Run scheduled task...
})

// Queue consumer
const queue = (batch: MessageBatch) => Effect.gen(function*() {
  const db = yield* D1
  // Process queue messages...
})

// Compose layers
const makeAppLayer = (env: Env, ctx: ExecutionContext) =>
  Layer.mergeAll(
    KV.layer(env.MY_KV),
    D1.layer(env.MY_DB),
    Worker.ExecutionCtx.layer(ctx),
  )

// Export handlers
export default {
  fetch: Worker.serve(handler, makeAppLayer),
  scheduled: Worker.onScheduled(scheduled, makeAppLayer),
  queue: Worker.onQueue(queue, makeAppLayer),
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
      
      // Put
      yield* kv.put("key", { value: "test" })
      
      // Get
      const result = yield* kv.get("key")
      expect(result).toEqual({ value: "test" })
    }).pipe(
      Effect.provide(KV.layer(Testing.memoryKV()))
    )
  )
})
```

Available mocks:
- `Testing.memoryKV()` — KV
- `Testing.memoryD1()` — D1
- `Testing.memoryR2()` — R2
- `Testing.memoryQueue()` — Queue
- `Testing.memoryCache()` — Cache
- `Testing.memoryDOStorage()` — Durable Object storage

## Error Types

### Shared Errors (`effectful-cloudflare/Errors`)

```ts
// Binding not available (internal)
class BindingError extends Data.TaggedError("BindingError")<{
  service: string
  message: string
}>

// Native CF exception (internal)
class TransportError extends Data.TaggedError("TransportError")<{
  service: string
  operation: string
  cause: unknown
}>

// Schema validation failed (serializable)
class SchemaError extends Schema.TaggedErrorClass<SchemaError>()(
  "SchemaError",
  {
    message: Schema.String,
    cause: Schema.Defect,
  }
)

// Resource not found (serializable, HTTP 404)
class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  {
    resource: Schema.String,
    key: Schema.String,
  },
  { httpApiStatus: 404 }
)
```

### Module-Specific Errors

Each module exports its own error types:

- **KV:** `KVError`
- **D1:** `D1Error`, `D1QueryError`, `D1MigrationError`
- **R2:** `R2Error`, `R2MultipartError`, `R2PresignError`
- **Queue:** `QueueError`, `QueueSendError`, `QueueConsumerError`
- **DurableObject:** `DOError`, `StorageError`, `AlarmError`, `SqlError`, `WebSocketError`
- **Cache:** `CacheError`
- **AI:** `AIError`, `AIModelError`
- **AIGateway:** `AIGatewayError`, `AIGatewayRequestError`, `AIGatewayResponseError`
- **Vectorize:** `VectorizeError`, `VectorizeNotFoundError`
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
7. **Effect v4 native** — No v3 patterns. `ServiceMap`, `Result`, `Effect.fn`, `LayerMap`.

## Project Structure

```
effectful-cloudflare/
├── src/
│   ├── index.ts           # Re-exports all modules
│   ├── Errors.ts          # Shared error types
│   ├── Worker.ts          # Worker entrypoint
│   ├── KV.ts              # Workers KV
│   ├── D1.ts              # D1 Database
│   ├── R2.ts              # R2 Object Storage
│   ├── Queue.ts           # Queues
│   ├── DurableObject.ts   # Durable Objects
│   ├── Cache.ts           # Cache API
│   ├── AI.ts              # Workers AI
│   ├── AIGateway.ts       # AI Gateway
│   ├── Vectorize.ts       # Vectorize
│   ├── Hyperdrive.ts      # Hyperdrive
│   ├── Browser.ts         # Browser Rendering
│   ├── Pipeline.ts        # Pipelines
│   └── Testing.ts         # In-memory mocks
├── test/                  # Vitest tests
├── docs/                  # Documentation
└── package.json
```

## Requirements

- **Effect:** `^4.0.0-beta`
- **TypeScript:** `^5.9`
- **Cloudflare Workers:** Latest (2024+)

## License

MIT © itsbroly

## Links

- [GitHub](https://github.com/itsbroly/effectful-cloudflare)
- [npm](https://www.npmjs.com/package/effectful-cloudflare)
- [Effect Documentation](https://effect.website)
- [Cloudflare Workers](https://workers.cloudflare.com)

## Contributing

Contributions welcome! Please open an issue or PR.

## Acknowledgments

Inspired by [`effect-cf`](https://github.com/jbt95/effect-cf)
