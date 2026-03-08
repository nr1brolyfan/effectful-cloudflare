# IMPLEMENTATION: effectful-cloudflare

> **Status:** Not Started
> **Created:** 2026-03-07

---

## Progress Tracker

| # | Major Task | Status | Progress |
|---|-----------|--------|----------|
| 1 | Project Bootstrap & Tooling | In Progress | 4/6 |
| 2 | Shared Errors Module (`src/Errors.ts`) | ✅ Complete | 4/4 |
| 3 | Worker Entrypoint Module (`src/Worker.ts`) | ✅ Complete | 5/5 |
| 4 | KV Module (`src/KV.ts`) | ✅ Complete | 8/8 |
| 5 | KV Testing & In-Memory Mock | ✅ Complete | 5/5 |
| 6 | D1 Module (`src/D1.ts`) | ✅ Complete | 8/8 |
| 7 | R2 Module (`src/R2.ts`) | ✅ Complete | 9/9 |
| 8 | Queue Module (`src/Queue.ts`) | ✅ Complete | 7/7 |
| 9 | Cache Module (`src/Cache.ts`) | ✅ Complete | 6/6 |
| 10 | Testing Module — Storage Mocks | In Progress | 3/6 |
| 11 | DurableObject Module (`src/DurableObject.ts`) | Not Started | 0/10 |
| 12 | Vectorize Module (`src/Vectorize.ts`) | Not Started | 0/5 |
| 13 | Hyperdrive Module (`src/Hyperdrive.ts`) | Not Started | 0/4 |
| 14 | AI Module (`src/AI.ts`) | Not Started | 0/6 |
| 15 | AIGateway Module (`src/AIGateway.ts`) | Not Started | 0/5 |
| 16 | Browser & Pipeline Modules | Not Started | 0/4 |
| 17 | Barrel Exports & Package Publishing | Not Started | 0/5 |
| 18 | Documentation & CI/CD | Not Started | 0/5 |

**Overall: 59/108 tasks complete**

---

## Major Task 1: Project Bootstrap & Tooling

> **Files touched:** 6 files
> **Estimated context:** ~15k tokens

Clean out the Vite starter scaffold and set up the library project structure with proper Effect v4 dependencies, TypeScript config, build tooling, and test runner.

### 1.1 Remove Vite starter boilerplate

- [x] **Delete all Vite starter files:** `src/main.ts`, `src/counter.ts`, `src/style.css`, `src/typescript.svg`, `public/vite.svg`, `index.html`. These are the default Vite template files and have nothing to do with the library.

### 1.2 Install dependencies

- [x] **Set up package.json for library mode:**
  - Set `"name": "effectful-cloudflare"`, `"version": "0.1.0"`, `"type": "module"`
  - Remove Vite scripts (`dev`, `build`, `preview`) — replace with `tsup` build + `vitest` test
  - Add peer dependency: `"effect": "^4.0.0"`
  - Add dev dependencies: `"@cloudflare/workers-types": "^4.20260128.0"`, `"vitest": "^3.x"`, `"@effect/vitest": "^4.x"`, `"tsup": "^8.x"`, `"typescript": "^5.9"`
  - Remove `"vite"` from devDependencies
  - Add `"scripts"`: `"build": "tsup"`, `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "tsc --noEmit"`, `"prepublishOnly": "tsup"`
  - Run `bun install`

### 1.3 Configure TypeScript for library

- [x] **Rewrite `tsconfig.json`:**
  - Target: `ES2022`, Module: `ESNext`, Module resolution: `bundler`
  - `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
  - `rootDir: "src"`, `outDir: "dist"`, `declaration: true`, `declarationMap: true`
  - Remove `"types": ["vite/client"]` — add `"types": ["@cloudflare/workers-types"]`
  - Remove DOM libs — this is a Workers library, not a browser app
  - Set `include: ["src"]`

### 1.4 Configure tsup for ESM-only build

- [x] **Create `tsup.config.ts`:**
  - Entry points: one per module file (`src/index.ts`, `src/KV.ts`, `src/D1.ts`, etc.)
  - Format: `["esm"]` only (Workers are ESM-only)
  - Target: `es2022`
  - `dts: true` for type declarations
  - `external: ["effect"]` — peer dep, don't bundle

### 1.5 Configure Vitest

- [x] **Create `vitest.config.ts`:**
  - Test environment: `node` (unit tests with in-memory mocks)
  - Include: `test/**/*.test.ts`
  - Reference: effect-cf uses plain vitest with `environment: "node"`

### 1.6 Set up subpath exports in package.json

- [x] **Add `"exports"` field** to `package.json` matching the planned structure:
  ```json
  {
    "exports": {
      ".":               { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
      "./KV":            { "import": "./dist/KV.js", "types": "./dist/KV.d.ts" },
      "./D1":            { "import": "./dist/D1.js", "types": "./dist/D1.d.ts" },
      "./R2":            { "import": "./dist/R2.js", "types": "./dist/R2.d.ts" },
      "./Queue":         { "import": "./dist/Queue.js", "types": "./dist/Queue.d.ts" },
      "./DurableObject": { "import": "./dist/DurableObject.js", "types": "./dist/DurableObject.d.ts" },
      "./Cache":         { "import": "./dist/Cache.js", "types": "./dist/Cache.d.ts" },
      "./AI":            { "import": "./dist/AI.js", "types": "./dist/AI.d.ts" },
      "./AIGateway":     { "import": "./dist/AIGateway.js", "types": "./dist/AIGateway.d.ts" },
      "./Vectorize":     { "import": "./dist/Vectorize.js", "types": "./dist/Vectorize.d.ts" },
      "./Hyperdrive":    { "import": "./dist/Hyperdrive.js", "types": "./dist/Hyperdrive.d.ts" },
      "./Worker":        { "import": "./dist/Worker.js", "types": "./dist/Worker.d.ts" },
      "./Browser":       { "import": "./dist/Browser.js", "types": "./dist/Browser.d.ts" },
      "./Pipeline":      { "import": "./dist/Pipeline.js", "types": "./dist/Pipeline.d.ts" },
      "./Errors":        { "import": "./dist/Errors.js", "types": "./dist/Errors.d.ts" },
      "./Testing":       { "import": "./dist/Testing.js", "types": "./dist/Testing.d.ts" }
    }
  }
  ```
  Also add `"publishConfig"` field to map source entrypoints for development.

**Pause: Commit as `feat: bootstrap project with effect v4 tooling`**

---

## Major Task 2: Shared Errors Module (`src/Errors.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~15k tokens

Create the shared error types used across all service modules. These follow the v4 error patterns: `Schema.TaggedErrorClass` for serializable domain errors, `Data.TaggedError` for internal infrastructure errors.

### 2.1 Create `src/Errors.ts`

- [x] **Define `BindingError`** — `Data.TaggedError("BindingError")`:
  ```ts
  import { Data, Schema } from "effect"

  export class BindingError extends Data.TaggedError("BindingError")<{
    readonly service: string
    readonly message: string
  }> {}
  ```
  Used when a CF binding is not available. Internal error, not serializable.

### 2.2 Define `TransportError`

- [x] **Define `TransportError`** — `Data.TaggedError("TransportError")`:
  ```ts
  export class TransportError extends Data.TaggedError("TransportError")<{
    readonly service: string
    readonly operation: string
    readonly cause: unknown
  }> {}
  ```
  Wraps unexpected native CF exceptions. Internal error, `cause` is `unknown`.

### 2.3 Define `SchemaError`

- [x] **Define `SchemaError`** — `Schema.TaggedErrorClass`:
  ```ts
  export class SchemaError extends Schema.TaggedErrorClass<SchemaError>()(
    "SchemaError",
    {
      message: Schema.String,
      cause: Schema.Defect,
    }
  ) {}
  ```
  Domain error for schema decode/encode failures. Serializable. Used when schema validation is opted in.

### 2.4 Define `NotFoundError`

- [x] **Define `NotFoundError`** — `Schema.TaggedErrorClass`:
  ```ts
  export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
    "NotFoundError",
    {
      resource: Schema.String,
      key: Schema.String,
    },
    { httpApiStatus: 404 }
  ) {}
  ```
  Serializable, includes `httpApiStatus: 404` for HTTP API integration. Used by `getOrFail` methods.

**Pause: Commit as `feat(errors): add shared tagged error types`**

---

## Major Task 3: Worker Entrypoint Module (`src/Worker.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~25k tokens

Create the Worker module providing `serve()`, `onScheduled()`, `onQueue()`, `ExecutionCtx` service, and `WorkerEnv` service. These are the bridge between CF Worker lifecycle events and the Effect runtime.

### 3.1 Define `WorkerEnv` service

- [x] **Create `src/Worker.ts`** with `WorkerEnv` service:
  ```ts
  import { Effect, Layer, ServiceMap } from "effect"

  export class WorkerEnv extends ServiceMap.Service<WorkerEnv, Record<string, unknown>>()(
    "effectful-cloudflare/WorkerEnv"
  ) {
    static layer = (env: Record<string, unknown>) =>
      Layer.succeed(this, this.of(env))
  }
  ```
  Provides raw worker environment (bindings) as a service.

### 3.2 Define `ExecutionCtx` service

- [x] **Define `ExecutionCtx` service:**
  ```ts
  export class ExecutionCtx extends ServiceMap.Service<ExecutionCtx, {
    readonly waitUntil: (effect: Effect.Effect<void, never>) => Effect.Effect<void>
    readonly passThroughOnException: () => Effect.Effect<void>
  }>()(
    "effectful-cloudflare/ExecutionCtx"
  ) {
    static make = Effect.fn("ExecutionCtx.make")(function*(ctx: ExecutionContext) {
      return ExecutionCtx.of({
        waitUntil: (effect) => Effect.sync(() => ctx.waitUntil(Effect.runPromise(effect))),
        passThroughOnException: () => Effect.sync(() => ctx.passThroughOnException()),
      })
    })
    static layer = (ctx: ExecutionContext) => Layer.effect(this)(this.make(ctx))
  }
  ```
  Uses `Effect.fn` for tracing.

### 3.3 Implement `serve()` function

- [x] **Implement `serve()`** — Creates `ExportedHandler.fetch` from an Effect program:
  - Accepts `handler: (request: Request) => Effect<Response, E, R>` and `layers: (env, ctx) => Layer<R>`
  - Returns `ExportedHandler` with `.fetch` property
  - Wraps handler in `Effect.provide(layer)`, catches all causes, returns 500 on unhandled errors
  - Use `Effect.catchCause` (v4 rename from `catchAllCause`)
  - Reference: `docs/PROJECT_PLAN.md` lines 527-545

### 3.4 Implement `onScheduled()` function

- [x] **Implement `onScheduled()`** — Creates `ExportedHandler.scheduled` from an Effect program:
  - Accepts `handler: (controller: ScheduledController) => Effect<void, E, R>` and `layers`
  - Returns `Pick<ExportedHandler, "scheduled">`
  - Reference: `docs/PROJECT_PLAN.md` lines 550-560

### 3.5 Implement `onQueue()` function

- [x] **Implement `onQueue()`** — Creates `ExportedHandler.queue` from an Effect program:
  - Accepts `handler: (batch: MessageBatch<T>) => Effect<void, E, R>` and `layers`
  - Returns `Pick<ExportedHandler, "queue">`
  - Reference: `docs/PROJECT_PLAN.md` lines 565-575

**Pause: Commit as `feat(worker): add Worker entrypoint with serve, onScheduled, onQueue`**

---

## Major Task 4: KV Module (`src/KV.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~50k tokens

Full KV service implementation. This is the flagship module — the design pattern established here will be replicated across all other services.

### 4.1 Define `KVBinding` structural type

- [x] **Define `KVBinding` type** using `Pick<KVNamespace, ...>`:
  ```ts
  export type KVBinding = {
    get(key: string, options?: { type?: string; cacheTtl?: number }): Promise<string | null>
    getWithMetadata<M = unknown>(key: string, options?: { type?: string; cacheTtl?: number }): Promise<{ value: string | null; metadata: M | null }>
    put(key: string, value: string, options?: { expiration?: number; expirationTtl?: number; metadata?: unknown }): Promise<void>
    delete(key: string): Promise<void>
    list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult>
  }
  ```
  Structural type — doesn't require `@cloudflare/workers-types` at runtime.

### 4.2 Define KV-specific error

- [x] **Define `KVError`:**
  ```ts
  export class KVError extends Data.TaggedError("KVError")<{
    readonly operation: string
    readonly key?: string
    readonly cause: unknown
  }> {}
  ```
  Module-specific error wrapping CF KV exceptions.

### 4.3 Define options and result types

- [x] **Define `KVGetOptions`, `KVPutOptions`, `KVListOptions`, `KVListResult`, `KVValueWithMetadata`** as TypeScript interfaces. Reference: `docs/PROJECT_PLAN.md` Appendix B (lines 849-877).

### 4.4 Define `KV` service class with `ServiceMap.Service`

- [x] **Define the `KV` service class:**
  ```ts
  export class KV extends ServiceMap.Service<KV, {
    readonly get: (key: string, options?: KVGetOptions) => Effect.Effect<string | null, KVError>
    readonly getOrFail: (key: string, options?: KVGetOptions) => Effect.Effect<string, KVError | NotFoundError>
    readonly getWithMetadata: <M = unknown>(key: string, options?: KVGetOptions) => Effect.Effect<KVValueWithMetadata<string, M>, KVError>
    readonly put: (key: string, value: string | ArrayBuffer | ReadableStream, options?: KVPutOptions) => Effect.Effect<void, KVError>
    readonly delete: (key: string) => Effect.Effect<void, KVError>
    readonly list: (options?: KVListOptions) => Effect.Effect<KVListResult, KVError>
  }>()(
    "effectful-cloudflare/KV"
  ) { ... }
  ```
  Key: shape is explicit in type params, id string in second call.

### 4.5 Implement `KV.make(binding)`

- [x] **Implement `static make`** using `Effect.fn` for each method:
  - `get`: wraps `binding.get(key, { type: "text", ...options })` in `Effect.tryPromise`, maps error to `KVError`
  - `getOrFail`: calls `get`, checks null, yields `NotFoundError`
  - `getWithMetadata`: wraps `binding.getWithMetadata`, maps result
  - `put`: wraps `binding.put`
  - `delete`: wraps `binding.delete`
  - `list`: wraps `binding.list`
  - Each method body uses `Effect.fn("KV.methodName")` for auto-tracing
  - Returns `KV.of({ get, getOrFail, getWithMetadata, put, delete: del, list })`

### 4.6 Implement `KV.layer(binding)`

- [x] **Implement `static layer`:**
  ```ts
  static layer = (binding: KVBinding) =>
    Layer.effect(this)(this.make(binding))
  ```
  Simple wrapper — binding is required, fail-fast design.

### 4.7 Built-in JSON serialization with optional schema

- [x] **KV always serializes/deserializes JSON automatically:**
  - `KV.make(binding)` — untyped, values are `unknown`, auto JSON stringify/parse
  - `KV.make(binding, schema)` — typed, values validated via `Schema.encodeSync`/`Schema.decodeUnknownSync`
  - `KV.layer(binding)` / `KV.layer(binding, schema)` — same pattern
  - Schema constraint: `PureSchema<A>` requires `DecodingServices: never` and `EncodingServices: never`
  - No separate `.json()` factory — schema is an optional second argument
  - Zero `as any` casts needed in tests or implementation

### 4.8 Implement `KVMap` LayerMap for multi-instance

- [x] **Implement `KVMap` using `LayerMap.Service`:**
  ```ts
  export class KVMap extends LayerMap.Service<KVMap>()("effectful-cloudflare/KVMap", {
    lookup: (name: string) =>
      Layer.effect(KV)(
        Effect.gen(function*() {
          const env = yield* WorkerEnv
          const binding = env[name] as KVBinding
          return yield* KV.make(binding)
        })
      ),
    idleTimeToLive: "5 minutes",
  }) {}
  ```
  Allows dynamic KV namespace resolution by binding name.

**Pause: Commit as `feat(kv): add KV service with built-in JSON serialization and LayerMap support`**

---

## Major Task 5: KV Testing & In-Memory Mock

> **Files touched:** 3 files
> **Estimated context:** ~35k tokens

Create the first testing infrastructure: an in-memory KV mock and comprehensive tests for the KV module. This establishes the test pattern for all subsequent modules.

### 5.1 Create `src/Testing.ts` with `memoryKV()`

- [x] **Implement `memoryKV(): KVBinding`** — in-memory KV implementation:
  - Internal `Map<string, { value: string; metadata: unknown; expiration?: number }>` store
  - `get`: check expiration, return value or null
  - `getWithMetadata`: same + return metadata
  - `put`: store value with metadata and expiration
  - `delete`: remove from map
  - `list`: filter by prefix, paginate with limit/cursor, return `list_complete` and `cursor`
  - Reference: `repos/effect-cf/src/testing/index.ts` `createMemoryKv()` (handles expiration TTL, cursor-based pagination)

### 5.2 Create KV unit tests — basic operations

- [x] **Create `test/KV.test.ts`** with basic get/put/delete/list tests:
  - `get` returns null for missing keys
  - `put` then `get` roundtrip returns the value
  - `delete` removes the key
  - `list` returns keys with prefix filtering
  - All tests use `Effect.provide(KV.layer(Testing.memoryKV()))` pattern

### 5.3 Test `getOrFail` and error handling

- [x] **Test `getOrFail`:**
  - Returns value when key exists
  - Fails with `NotFoundError` when key is missing
  - Verify error tag: `Effect.catchTag("NotFoundError", (e) => ...)` works correctly

### 5.4 Test KV schema validation mode

- [x] **Test `KV.layer(binding, schema)` variant:**
  - Define a test schema (`Schema.Struct({ id: Schema.String, name: Schema.String, email: Schema.String })`)
  - Put an object, get it back decoded — zero `as any` casts
  - Tests for automatic JSON serialization (objects, arrays, numbers, booleans)
  - `getOrFail` with schema returns decoded object or `NotFoundError`

### 5.5 Test KV metadata and expiration

- [x] **Test metadata and advanced features:**
  - `getWithMetadata` returns value + metadata
  - `put` with expiration options (verify in mock by checking internal state or waiting)
  - `list` pagination (cursor-based)
  - Verify `KVError` wrapping when binding throws

**Pause: Commit as `feat(testing): add in-memory KV mock and comprehensive KV tests`**

---

## Major Task 6: D1 Module (`src/D1.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~50k tokens

SQL database service with schema-validated queries, batch operations, and migrations.

### 6.1 Define `D1Binding` structural type

- [x] **Define `D1Binding` type:**
  ```ts
  export type D1Binding = {
    prepare(sql: string): D1PreparedStatement
    batch<T = unknown>(statements: ReadonlyArray<D1PreparedStatement>): Promise<ReadonlyArray<D1Result<T>>>
    exec(sql: string): Promise<D1ExecResult>
    dump(): Promise<ArrayBuffer>
  }
  ```
  Reference: `repos/effect-cf/src/d1/types.ts` for the exact CF types needed.

### 6.2 Define D1-specific errors

- [x] **Define D1 errors:**
  ```ts
  export class D1Error extends Data.TaggedError("D1Error")<{
    readonly operation: string
    readonly message: string
    readonly cause?: unknown
  }> {}

  export class D1QueryError extends Data.TaggedError("D1QueryError")<{
    readonly sql: string
    readonly params?: ReadonlyArray<unknown>
    readonly message: string
    readonly cause?: unknown
  }> {}

  export class D1MigrationError extends Data.TaggedError("D1MigrationError")<{
    readonly migrationName?: string
    readonly message: string
    readonly cause?: unknown
  }> {}
  ```
  `D1QueryError` includes the SQL and params for debugging. `D1MigrationError` includes the migration name.

### 6.3 Define D1 service class

- [x] **Define `D1` service with `ServiceMap.Service`** — API surface per `docs/PROJECT_PLAN.md` Appendix C:
  - `query<T>(sql, ...params)` — returns `ReadonlyArray<T>`
  - `querySchema<A, I>(schema, sql, ...params)` — returns `ReadonlyArray<A>`, schema-validated
  - `queryFirst<T>(sql, ...params)` — returns `T | null`
  - `queryFirstOrFail<T>(sql, ...params)` — returns `T`, fails with `NotFoundError`
  - `queryFirstSchema<A, I>(schema, sql, ...params)` — schema-validated first row
  - `batch(statements)` — atomic batch
  - `exec(sql)` — raw SQL execution
  - `migrate(migrations)` — run pending migrations (not implemented yet)

### 6.4 Implement `D1.make(binding)` — core query methods

- [x] **Implement `make`** with `Effect.fn` for each method:
  - `query`: `binding.prepare(sql).bind(...params).all()`, check `result.success`, extract `result.results`
  - `queryFirst`: same but `.first()`
  - `queryFirstOrFail`: chain with null check -> `NotFoundError`
  - Wrap CF errors in `D1QueryError` with the SQL string for debugging

### 6.5 Implement schema-validated query variants

- [x] **Implement `querySchema` and `queryFirstSchema`:**
  - After getting raw results, decode each row with `Schema.decodeUnknownEffect(schema)`
  - Wrap decode errors in `SchemaError`
  - Use `Effect.forEach` for row-by-row validation (clear errors on which row failed)

### 6.6 Implement batch and exec

- [x] **Implement `batch` and `exec`:**
  - `batch`: wraps `binding.batch(statements)`, maps errors to `D1Error`
  - `exec`: wraps `binding.exec(sql)`, maps errors to `D1Error`

### 6.7 Implement migrations runner

- [x] **Implement `migrate(migrations)`:**
  - Creates `__migrations` tracking table on first run
  - Queries applied migrations, computes diff
  - Runs pending migrations in order via `exec`
  - Wraps failures in `D1MigrationError` with the migration name
  - Reference: `repos/effect-cf/src/d1/migrations.ts`

### 6.8 Implement `D1.layer(binding)` and `D1Map`

- [x] **Implement layer + LayerMap:**
  - `static layer = (binding) => Layer.effect(this)(this.make(binding))`
  - `D1Map` via `LayerMap.Service` for multi-database scenarios (same pattern as `KVMap`)

**Pause: Commit as `feat(d1): add D1 service with schema queries, batch, and migrations`**

---

## Major Task 7: R2 Module (`src/R2.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~55k tokens

Object storage service with multipart uploads and presigned URLs.

### 7.1 Define `R2Binding` structural type

- [x] **Define `R2Binding` type** with methods: `get`, `put`, `delete`, `head`, `list`, `createMultipartUpload`, `resumeMultipartUpload`. Reference: `repos/effect-cf/src/r2/types.ts`.

### 7.2 Define R2-specific errors

- [x] **Define R2 errors:**
  - `R2Error` — general object operation failed (includes `operation`, `key`)
  - `R2MultipartError` — multipart upload failed (includes `operation: "create"|"upload"|"complete"|"abort"`, `uploadId`)
  - `R2PresignError` — presigned URL generation failed
  Reference: `docs/PROJECT_PLAN.md` lines 372-376.

### 7.3 Define R2 result types

- [x] **Define result types:** `R2ObjectInfo` (simplified object metadata), `R2ListResult`, `R2GetOptions`, `R2PutOptions`, `R2PutValue`, `R2ListOptions`, `R2MultipartOptions`, `R2PresignOptions`. Map CF R2 types to clean interfaces.

### 7.4 Define `R2` service class

- [x] **Define `R2` service with `ServiceMap.Service`** — API per `docs/PROJECT_PLAN.md` Appendix D:
  - `get(key, options?)` -> `R2Object | null`
  - `getOrFail(key, options?)` -> `R2Object` (or `NotFoundError`)
  - `put(key, value, options?)` -> `R2ObjectInfo`
  - `delete(key | keys[])` -> `void`
  - `head(key)` -> `R2ObjectInfo | null`
  - `list(options?)` -> `R2ListResult`
  - `createMultipartUpload(key, options?)` -> `R2MultipartUpload`
  - `resumeMultipartUpload(key, uploadId)` -> `R2MultipartUpload`

### 7.5 Implement `R2.make(binding)` — basic CRUD

- [x] **Implement `make`** with `Effect.fn` for get, put, delete, head, list:
  - Each wraps `binding.method()` in `Effect.tryPromise`
  - `put` and `head` map `R2Object` to simplified `R2ObjectInfo` (strip methods, keep metadata)
  - `list` handles cursor/truncation/prefix

### 7.6 Implement multipart upload methods

- [x] **Implement multipart:**
  - `createMultipartUpload`: wraps `binding.createMultipartUpload(key, options)`
  - `resumeMultipartUpload`: wraps `binding.resumeMultipartUpload(key, uploadId)`
  - Wrap errors in `R2MultipartError` with appropriate `operation` field

### 7.7 Implement presigned URL generation

- [x] **Implement `presign(key, options)`:**
  - AWS Signature V4 implementation using Web Crypto API (no external deps)
  - Takes `R2PresignConfig` (accessKeyId, secretAccessKey, accountId, bucketName)
  - Generates S3-compatible presigned URLs for R2
  - Reference: `repos/effect-cf/src/r2/presign.ts` for the full AWSSigV4 implementation

### 7.8 ~~`R2.json(schema)` factory~~ — Removed

- [x] **Removed:** R2 is binary object storage, not key-value. A `.json()` factory was an
  unnecessary abstraction that forced type-unsafe `as any` casts. Users who need JSON in R2
  can use `JSON.stringify`/`JSON.parse` directly or use KV instead.

### 7.9 Implement layer and LayerMap

- [x] **Implement `R2.layer(binding)` and `R2Map`** — same pattern as KV.

**Pause: Commit as `feat(r2): add R2 service with multipart and presigned URLs`**

---

## Major Task 8: Queue Module (`src/Queue.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~35k tokens

Message queue producer and consumer with schema-validated messages.

### 8.1 Define `QueueBinding` structural type

- [x] **Define `QueueBinding` type:**
  ```ts
  export type QueueBinding<T = unknown> = {
    send(message: T, options?: { contentType?: string; delaySeconds?: number }): Promise<void>
    sendBatch(messages: ReadonlyArray<{ body: T; contentType?: string; delaySeconds?: number }>): Promise<void>
  }
  ```

### 8.2 Define Queue-specific errors

- [x] **Define Queue errors:**
  - `QueueError` — general queue operation failure
  - `QueueSendError` — send/sendBatch failed
  - `QueueConsumerError` — consumer handler failed

### 8.3 Define `QueueProducer` service class

- [x] **Define `QueueProducer` service:**
  - `send(message, options?)` -> `Effect<void, QueueSendError>`
  - `sendBatch(messages)` -> `Effect<void, QueueSendError>`
  - `static make(binding)` using `Effect.fn` for each method
  - `static layer(binding)`

### 8.4 Implement schema-validated producer

- [x] **Implement `QueueProducer.json(schema)` factory:**
  - `send`: schema encode -> JSON.stringify -> raw send with contentType: "application/json"
  - `sendBatch`: schema encode each message in parallel -> raw sendBatch
  - Error channel includes `SchemaError`

### 8.5 Implement consumer handler pattern

- [x] **Implement consumer handler:**
  ```ts
  export const consume = <T>(options?: {
    schema?: Schema.Schema<T, unknown>
  }) => ({
    handler: <E, R>(fn: (message: T, metadata: QueueMessageMetadata) => Effect.Effect<void, E, R>) => ...
  })
  ```
  - If schema provided, decode each message before passing to handler
  - Return a CF-compatible queue handler that bridges Effect to the CF `queue()` export
  - Auto-ack on success, auto-retry on failure
  - Reference: `repos/effect-cf/src/queues/queues.ts` `createConsumer` pattern

### 8.6 Implement `onQueue()` integration

- [x] **Wire up with `Worker.onQueue()`:**
  - Ensure the consumer handler integrates with the Worker module's `onQueue` export
  - Batch-level error handling: individual message failures vs. batch failures

### 8.7 Implement `QueueProducerMap` LayerMap

- [x] **Implement `QueueProducerMap`** for multi-queue producer scenarios.

**Pause: Commit as `feat(queue): add Queue producer, consumer, and schema validation`**

---

## Major Task 9: Cache Module (`src/Cache.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~30k tokens

CF Cache API service with JSON mode and schema validation.

### 9.1 Define `CacheBinding` structural type

- [x] **Define `CacheBinding` type:**
  ```ts
  export type CacheBinding = {
    match(request: Request | string, options?: CacheQueryOptions): Promise<Response | undefined>
    put(request: Request | string, response: Response): Promise<void>
    delete(request: Request | string, options?: CacheQueryOptions): Promise<boolean>
  }
  ```

### 9.2 Define Cache-specific error

- [x] **Define `CacheError`:**
  ```ts
  export class CacheError extends Data.TaggedError("CacheError")<{
    readonly operation: string
    readonly message: string
    readonly cause?: unknown
  }> {}
  ```

### 9.3 Define `Cache` service class

- [x] **Define `Cache` service:**
  - `match(request)` -> `Effect<Response | null, CacheError>`
  - `matchOrFail(request)` -> `Effect<Response, CacheError | NotFoundError>`
  - `put(request, response)` -> `Effect<void, CacheError>`
  - `delete(request)` -> `Effect<boolean, CacheError>`

### 9.4 Implement `Cache.make(binding)` and layer

- [x] **Implement `make`** with `Effect.fn` for each method. Map `undefined` responses to `null` for consistency with other modules.

### 9.5 Implement `Cache.json(schema)` factory

- [x] **Implement JSON mode:**
  - `match`: get response -> read body as text -> JSON.parse -> schema decode
  - `put`: schema encode -> JSON.stringify -> create Response with JSON content-type -> raw put
  - `matchOrFail`: schema decode + null check -> `NotFoundError`
  - Reference: `repos/effect-cf/src/cache/cache.ts` for `matchJson`/`putJson` patterns

### 9.6 Implement layer

- [x] **Implement `Cache.layer(binding)` and `Cache.defaultCache()`:**
  - `defaultCache()`: uses `caches.default` (the global CF cache)
  - `namedCache(name)`: uses `caches.open(name)`

**Pause: Commit as `feat(cache): add Cache API service with JSON mode`**

---

## Major Task 10: Testing Module — Storage Mocks

> **Files touched:** 2 files
> **Estimated context:** ~40k tokens

Extend `src/Testing.ts` with in-memory mocks for D1, R2, Queue, Cache + tests for each storage service.

### 10.1 Implement `memoryD1(): D1Binding`

- [x] **In-memory D1 mock:**
  - Use a simple array-of-rows store or a SQLite WASM if available
  - `prepare(sql).bind(...params).all()` — basic SQL parsing for SELECT/INSERT/UPDATE/DELETE
  - Simpler approach: store as rows, parse SQL with regex for basic operations
  - Reference: `repos/effect-cf/src/d1/d1.test.ts` `createMockD1Database()` for the mock pattern

### 10.2 Implement `memoryR2(): R2Binding`

- [x] **In-memory R2 mock:**
  - Internal `Map<string, { body: ArrayBuffer; metadata: Record; httpMetadata: Record }>` store
  - `get`: return R2Object-like (with `.text()`, `.json()`, `.arrayBuffer()` methods)
  - `put`: store body + metadata
  - `delete`: remove
  - `head`: return metadata without body
  - `list`: filter/paginate
  - Reference: `repos/effect-cf/src/r2/r2.test.ts` `createMemoryR2Bucket()`

### 10.3 Implement `memoryQueue(): QueueBinding`

- [x] **In-memory Queue mock:**
  - Internal `messages: Array<{ body: unknown; contentType?: string; delaySeconds?: number }>` array
  - `send`: push to array
  - `sendBatch`: push all to array
  - Expose `messages` for test inspection
  - Reference: `repos/effect-cf/src/queues/queues.test.ts` `createMemoryQueue()`

### 10.4 Implement `memoryCache(): CacheBinding`

- [x] **In-memory Cache mock:**
  - Internal `Map<string, Response>` keyed by request URL
  - `match`: clone stored response
  - `put`: store response clone
  - `delete`: remove from map
  - Reference: `repos/effect-cf/src/testing/index.ts` `createMemoryCache()`

### 10.5 Write D1, R2, Queue tests

- [x] **Create tests:** `test/D1.test.ts`, `test/R2.test.ts`, `test/Queue.test.ts`:
  - D1: query roundtrip, queryFirst, queryFirstOrFail, batch, schema-validated queries, migration runner
  - R2: get/put/delete/head/list roundtrip, getOrFail on missing, multipart uploads
  - Queue: send/sendBatch, inspect mock messages, schema-validated send

### 10.6 Write Cache tests

- [ ] **Create `test/Cache.test.ts`:**
  - match/put/delete roundtrip
  - matchOrFail on missing returns `NotFoundError`
  - JSON mode with schema validation
  - defaultCache factory

**Pause: Commit as `feat(testing): add in-memory mocks for D1, R2, Queue, Cache and full test suite`**

---

## Major Task 11: DurableObject Module (`src/DurableObject.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~65k tokens

The most complex module. Provides: (1) Client service for calling DOs from Workers, (2) Server base class for building DOs with Effect, (3) Effect-wrapped storage API.

### 11.1 Define DO binding types

- [ ] **Define types:**
  ```ts
  export type DONamespaceBinding = {
    idFromName(name: string): DurableObjectId
    idFromString(hexStr: string): DurableObjectId
    newUniqueId(options?: { jurisdiction?: string }): DurableObjectId
    get(id: DurableObjectId): DurableObjectStub
  }
  ```
  Also `DOStorageBinding`, `DOSqlStorageBinding` for the storage wrapper.

### 11.2 Define DO-specific errors

- [ ] **Define DO errors:**
  - `DOError` — general client-side DO error
  - `StorageError` — DO storage operation failed (includes `operation`, `key`)
  - `AlarmError` — alarm operation failed
  - `SqlError` — DO SQLite query failed (includes `query`)
  - `WebSocketError` — WebSocket operation failed
  Reference: `docs/PROJECT_PLAN.md` lines 377-382.

### 11.3 Define `DOClient` service (caller side)

- [ ] **Define `DOClient` service:**
  - `stub(namespace, target: DOTarget)` -> `Effect<DurableObjectStub, DOError>`
  - `fetch(stub, request)` -> `Effect<Response, DOError>`
  - `fetchJson<T>(stub, path, options?)` -> `Effect<T, DOError>`
  - `DOTarget` = `{ type: "name"; name: string } | { type: "id"; id: string } | { type: "unique" }`

### 11.4 Implement `DOClient.make()`

- [ ] **Implement client service:**
  - `stub`: resolve target to `DurableObjectId` via `idFromName`/`idFromString`/`newUniqueId`, then `namespace.get(id)`
  - `fetch`: wraps `stub.fetch(request)` in `Effect.tryPromise`, maps errors to `DOError`
  - `fetchJson`: fetch + read response body as JSON, optionally schema-decode
  - Use `Effect.fn` for all methods

### 11.5 Implement Effect-wrapped storage (`EffectStorage`)

- [ ] **Implement storage wrapper:**
  ```ts
  export interface EffectStorage {
    readonly get: <T>(key: string) => Effect<T | undefined, StorageError>
    readonly put: <T>(key: string, value: T) => Effect<void, StorageError>
    readonly delete: (key: string) => Effect<boolean, StorageError>
    readonly deleteAll: () => Effect<void, StorageError>
    readonly list: <T>(options?: DOListOptions) => Effect<Map<string, T>, StorageError>
    readonly getAlarm: () => Effect<number | null, AlarmError>
    readonly setAlarm: (scheduledTime: number | Date) => Effect<void, AlarmError>
    readonly deleteAlarm: () => Effect<void, AlarmError>
    readonly transaction: <R, E, A>(fn: (txn: EffectStorage) => Effect<A, E>) => Effect<A, StorageError | E>
  }
  ```
  Each method wraps `DurableObjectStorage` calls with `Effect.tryPromise`.
  Reference: `repos/effect-cf/src/durable-objects/storage.ts`

### 11.6 Implement Effect-wrapped SQL storage

- [ ] **Implement `EffectSqlStorage`:**
  - `exec<T>(sql, ...params)` -> `Effect<ReadonlyArray<T>, SqlError>`
  - `execOne<T>(sql, ...params)` -> `Effect<T, SqlError>`
  - `databaseSize` -> `Effect<number, SqlError>`
  - Wraps `DurableObjectStorage.sql` calls

### 11.7 Implement `EffectDurableObject` server base class

- [ ] **Implement server base class:**
  ```ts
  export abstract class EffectDurableObject<Env = unknown> {
    readonly storage: EffectStorage
    readonly env: Env
    readonly id: DurableObjectId

    constructor(state: DurableObjectState, env: Env)

    abstract fetch(request: Request): Effect<Response, DOError>
    alarm?(): Effect<void, DOError>
    webSocketMessage?(ws: WebSocket, message: string | ArrayBuffer): Effect<void, DOError>
    webSocketClose?(ws: WebSocket, code: number, reason: string, wasClean: boolean): Effect<void, DOError>
    webSocketError?(ws: WebSocket, error: unknown): Effect<void, DOError>
  }
  ```
  - Constructor creates `EffectStorage` from `state.storage`
  - Internal `_fetch`, `_alarm`, `_webSocketMessage`, etc. bridge methods run `Effect.runPromise`
  - These bridge methods are what CF actually calls; they delegate to the abstract Effect methods
  - Reference: `repos/effect-cf/src/durable-objects/server.ts`

### 11.8 Implement DO WebSocket hibernation support

- [ ] **Implement WebSocket methods:**
  - `acceptWebSocket(ws, tags?)` -> `Effect<void, WebSocketError>`
  - `getWebSockets(tag?)` -> `Effect<ReadonlyArray<WebSocket>, WebSocketError>`
  - These wrap `state.acceptWebSocket()` and `state.getWebSockets()` for the Hibernation API

### 11.9 Implement `DOClient.layer()` and `DOMap`

- [ ] **Implement layer + LayerMap:**
  - `DOClient.layer()` — stateless, no binding needed at construction (unlike KV)
  - `DOMap` via `LayerMap.Service` for multiple DO namespaces

### 11.10 Write DurableObject tests

- [ ] **Create `test/DurableObject.test.ts`:**
  - Client: stub creation, fetch, fetchJson
  - Storage: get/put/delete/list roundtrip, transactions, alarm operations
  - SQL storage: exec, execOne
  - Server base class: concrete implementation, verify fetch/alarm lifecycle
  - Use `Testing.memoryDOStorage()` mock

**Pause: Commit as `feat(durable-object): add DO client, server base class, and storage wrappers`**

---

## Major Task 12: Vectorize Module (`src/Vectorize.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~25k tokens

Vector database service for similarity search.

### 12.1 Define `VectorizeBinding` structural type

- [ ] **Define `VectorizeBinding` type** with methods: `insert`, `upsert`, `query`, `getByIds`, `deleteByIds`, `describe`. Reference: `repos/effect-cf/src/vectorize/types.ts`.

### 12.2 Define Vectorize-specific errors

- [ ] **Define errors:**
  - `VectorizeError` — general operation failure (includes `operation`)
  - `VectorizeNotFoundError` — vector not found by ID

### 12.3 Define `Vectorize` service class

- [ ] **Define service:**
  - `insert(vectors)` -> `Effect<VectorizeMutationResult, VectorizeError>`
  - `upsert(vectors)` -> `Effect<VectorizeMutationResult, VectorizeError>`
  - `query(vector, options?)` -> `Effect<VectorizeQueryResult, VectorizeError>`
  - `getByIds(ids)` -> `Effect<ReadonlyArray<VectorizeVector>, VectorizeError>`
  - `deleteByIds(ids)` -> `Effect<VectorizeMutationResult, VectorizeError>`
  - `describe()` -> `Effect<VectorizeIndexInfo, VectorizeError>`

### 12.4 Implement `Vectorize.make(binding)` and layer

- [ ] **Implement make** with `Effect.fn` for each method. Wrap `binding.method()` in `Effect.tryPromise`, map errors to `VectorizeError`.

### 12.5 Write Vectorize tests

- [ ] **Create `test/Vectorize.test.ts`:**
  - Basic insert/query/getByIds/deleteByIds roundtrip with mock binding
  - Verify error wrapping

**Pause: Commit as `feat(vectorize): add Vectorize service`**

---

## Major Task 13: Hyperdrive Module (`src/Hyperdrive.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~15k tokens

Connection pooling service — the simplest module (only two operations).

### 13.1 Define `HyperdriveBinding` structural type

- [ ] **Define type:**
  ```ts
  export type HyperdriveBinding = {
    readonly connectionString: string
    readonly host: string
    readonly port: number
    readonly user: string
    readonly password: string
    readonly database: string
  }
  ```

### 13.2 Define `Hyperdrive` service class

- [ ] **Define service:**
  - `connectionString` -> `Effect<string, HyperdriveError>`
  - `connectionInfo` -> `Effect<HyperdriveConnectionInfo, HyperdriveError>`

### 13.3 Implement make and layer

- [ ] **Implement `Hyperdrive.make(binding)` and `static layer`:**
  - These are synchronous reads from the binding object
  - Use `Effect.try` instead of `Effect.tryPromise` (sync access)
  - Use `Effect.fn` for tracing

### 13.4 Write Hyperdrive tests

- [ ] **Create `test/Hyperdrive.test.ts`:**
  - Verify connectionString and connectionInfo return correct values from mock binding

**Pause: Commit as `feat(hyperdrive): add Hyperdrive service`**

---

## Major Task 14: AI Module (`src/AI.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~35k tokens

Workers AI service — run inference models directly in Workers.

### 14.1 Define `AIBinding` structural type

- [ ] **Define `AIBinding` type:**
  ```ts
  export type AIBinding = {
    run<T = unknown>(model: string, inputs: Record<string, unknown>, options?: AIRunOptions): Promise<T>
  }
  ```
  Workers AI binding is simple: one `run()` method with model name and inputs.

### 14.2 Define AI-specific errors

- [ ] **Define errors:**
  - `AIError` — general AI operation failure (includes `model`, `operation`)
  - `AIModelError` — model-specific error (includes `model`, `code`)

### 14.3 Define `AI` service class

- [ ] **Define service:**
  - `run<T>(model, inputs, options?)` -> `Effect<T, AIError>`
  - `runSchema<A, I>(model, schema, inputs, options?)` -> `Effect<A, AIError | SchemaError>` — schema-validated response
  - Support streaming option

### 14.4 Implement `AI.make(binding)` and layer

- [ ] **Implement make** with `Effect.fn`:
  - `run`: wraps `binding.run(model, inputs, options)` in `Effect.tryPromise`
  - `runSchema`: run + schema decode
  - Handle streaming responses (return `ReadableStream` when `options.stream: true`)

### 14.5 Schema validation for AI responses

- [ ] **Implement schema-validated variant:**
  - `runSchema<A>(model, schema, inputs, options?)` method on the AI service
  - Decode AI response with schema, map errors to `SchemaError`
  - No separate `.json()` factory — follow the KV pattern (schema as parameter)

### 14.6 Write AI tests

- [ ] **Create `test/AI.test.ts`:**
  - Mock binding returning test data
  - Verify `run` returns raw response
  - Verify `runSchema` decodes response
  - Verify error wrapping

**Pause: Commit as `feat(ai): add Workers AI service with schema validation`**

---

## Major Task 15: AIGateway Module (`src/AIGateway.ts`)

> **Files touched:** 1 file
> **Estimated context:** ~30k tokens

AI Gateway proxy — multi-provider AI routing with logging.

### 15.1 Define `AIGatewayBinding` structural type

- [ ] **Define `AIGatewayBinding` type:**
  ```ts
  export type AIGatewayBinding = {
    run(request: AIGatewayRequest): Promise<Response>
    run(requests: ReadonlyArray<AIGatewayRequest>): Promise<Response>
    getLog(logId: string): Promise<AIGatewayLog>
    patchLog(logId: string, options: { metadata?: Record<string, unknown>; score?: number }): Promise<void>
    getUrl(provider?: string): Promise<string>
  }
  ```
  Reference: `repos/effect-cf/src/ai-gateway/types.ts`

### 15.2 Define AIGateway-specific errors

- [ ] **Define errors:**
  - `AIGatewayError` — general gateway error
  - `AIGatewayRequestError` — request to gateway failed
  - `AIGatewayResponseError` — gateway returned error response (includes `status`)

### 15.3 Define `AIGateway` service class

- [ ] **Define service:**
  - `run(request)` -> `Effect<Response, AIGatewayError>`
  - `runBatch(requests)` -> `Effect<Response, AIGatewayError>`
  - `getLog(logId)` -> `Effect<AIGatewayLog, AIGatewayError>`
  - `patchLog(logId, options)` -> `Effect<void, AIGatewayError>`
  - `getUrl(provider?)` -> `Effect<string, AIGatewayError>`

### 15.4 Implement make and layer

- [ ] **Implement `AIGateway.make(binding)` and layer** with `Effect.fn` for each method.

### 15.5 Write AIGateway tests

- [ ] **Create `test/AIGateway.test.ts`** with mock binding.

**Pause: Commit as `feat(ai-gateway): add AI Gateway service`**

---

## Major Task 16: Browser & Pipeline Modules

> **Files touched:** 2 files
> **Estimated context:** ~25k tokens

### 16.1 Implement Browser module (`src/Browser.ts`)

- [ ] **Implement Browser Rendering service:**
  - `BrowserBinding` type (Puppeteer-like `fetch` for browser sessions)
  - `BrowserError` tagged error
  - `Browser` service with `launch()`, `navigate()`, `screenshot()`, `pdf()`, `evaluate()`
  - `Browser.make(binding)` + `Browser.layer(binding)`

### 16.2 Implement Pipeline module (`src/Pipeline.ts`)

- [ ] **Implement Pipeline service:**
  - `PipelineBinding` type
  - `PipelineError` tagged error
  - `Pipeline` service with `send(records)` for streaming ETL to R2
  - `Pipeline.make(binding)` + `Pipeline.layer(binding)`

### 16.3 Write Browser tests

- [ ] **Create `test/Browser.test.ts`** with mock binding.

### 16.4 Write Pipeline tests

- [ ] **Create `test/Pipeline.test.ts`** with mock binding.

**Pause: Commit as `feat: add Browser Rendering and Pipeline modules`**

---

## Major Task 17: Barrel Exports & Package Publishing

> **Files touched:** 3 files
> **Estimated context:** ~20k tokens

### 17.1 Create barrel `src/index.ts`

- [ ] **Create `src/index.ts`** re-exporting all modules as namespaces:
  ```ts
  export * as KV from "./KV.js"
  export * as D1 from "./D1.js"
  export * as R2 from "./R2.js"
  export * as Queue from "./Queue.js"
  export * as Cache from "./Cache.js"
  export * as DurableObject from "./DurableObject.js"
  export * as AI from "./AI.js"
  export * as AIGateway from "./AIGateway.js"
  export * as Vectorize from "./Vectorize.js"
  export * as Hyperdrive from "./Hyperdrive.js"
  export * as Worker from "./Worker.js"
  export * as Browser from "./Browser.js"
  export * as Pipeline from "./Pipeline.js"
  export * as Errors from "./Errors.js"
  export * as Testing from "./Testing.js"
  ```

### 17.2 Verify all subpath exports resolve

- [ ] **Run `tsc --noEmit`** to verify all exports compile. Fix any import path issues.

### 17.3 Verify tsup build produces correct output

- [ ] **Run `bun run build`** and verify:
  - All module `.js` and `.d.ts` files are generated in `dist/`
  - No bundling of `effect` (external peer dep)
  - Subpath exports resolve correctly

### 17.4 Add package metadata

- [ ] **Add to `package.json`:**
  - `"description"`, `"keywords"`, `"repository"`, `"license"`, `"author"`
  - `"files": ["dist", "README.md", "LICENSE"]`
  - `"sideEffects": false`

### 17.5 Run full test suite

- [ ] **Run `bun run test`** and verify all tests pass. Fix any failures.

**Pause: Commit as `chore: finalize barrel exports and package configuration`**

---

## Major Task 18: Documentation & CI/CD

> **Files touched:** 5 files
> **Estimated context:** ~20k tokens

### 18.1 Write README.md

- [ ] **Create `README.md`** with:
  - Library description, installation, quick start
  - Feature highlights (Effect v4, tagged errors, schema validation, LayerMap multi-instance)
  - Module catalog table
  - Basic usage example for each tier-1 module (KV, D1, R2, Queue, Worker)
  - Link to full docs

### 18.2 Add TSDoc to all public exports

- [ ] **Add TSDoc comments** to all service classes, make/layer statics, error classes, and type exports. Focus on:
  - What the service does
  - What parameters `make()` expects
  - What errors are in the error channel
  - Usage examples in doc comments

### 18.3 Create LICENSE file

- [ ] **Create `LICENSE`** — MIT license (same as effect-cf).

### 18.4 Set up GitHub Actions CI

- [ ] **Create `.github/workflows/ci.yml`:**
  - Run on push to main + PRs
  - Steps: install (bun), typecheck, test, build
  - Matrix: Node 20 + Node 22

### 18.5 Create example worker project

- [ ] **Create `examples/basic-worker/`** with:
  - `wrangler.jsonc` config
  - `src/index.ts` — minimal worker using `Worker.serve`, `KV`, `D1`
  - `package.json` depending on `effectful-cloudflare`
  - Brief README explaining how to run

**Pause: Commit as `docs: add README, TSDoc, CI, and example project`**
