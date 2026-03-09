/**
 * @module DurableObject
 *
 * Effect-wrapped Cloudflare Durable Objects (client, server, and storage).
 *
 * Provides:
 * - `DOClient` service — call Durable Objects from Workers (stub, fetch, fetchJson).
 * - `EffectDurableObject` abstract base class — build DOs with Effect handlers.
 * - `EffectStorage` — Effect-wrapped DurableObject key-value storage.
 * - `EffectSqlStorage` — Effect-wrapped DurableObject SQLite storage.
 * - WebSocket hibernation support (`acceptWebSocket`, `getWebSockets`).
 * - Alarm scheduling (`setAlarm`, `getAlarm`, `deleteAlarm`).
 * - Transactional storage operations.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { DOClient } from "effectful-cloudflare/DurableObject"
 *
 * const program = Effect.gen(function*() {
 *   const client = yield* DOClient
 *   const stub = yield* client.stub(env.MY_DO, { type: "name", name: "room-1" })
 *   const response = yield* client.fetch(stub, new Request("https://do/hello"))
 * }).pipe(Effect.provide(DOClient.layer()))
 * ```
 */

import { Cause, Data, Effect, Layer, Schema, ServiceMap } from "effect";
import * as Errors from "./Errors.js";

// ── Binding types ──────────────────────────────────────────────────────

/**
 * Minimal structural type for DurableObjectNamespace binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It extracts only the methods
 * we need from the native DurableObjectNamespace interface.
 *
 * @example
 * ```ts
 * // Use with native Cloudflare binding
 * const namespace: DONamespaceBinding = env.MY_DO
 *
 * // Create stub from name
 * const id = namespace.idFromName("my-instance")
 * const stub = namespace.get(id)
 * ```
 */
export interface DONamespaceBinding {
  /**
   * Get a stub to a Durable Object instance.
   */
  get(id: DurableObjectId): DurableObjectStub;
  /**
   * Create a Durable Object ID from a name.
   * The same name always returns the same ID.
   */
  idFromName(name: string): DurableObjectId;

  /**
   * Create a Durable Object ID from a hex string.
   */
  idFromString(hexStr: string): DurableObjectId;

  /**
   * Create a new unique Durable Object ID.
   */
  newUniqueId(options?: { jurisdiction?: string }): DurableObjectId;
}

/**
 * Minimal structural type for DurableObjectStorage.
 *
 * This type is used internally by the EffectStorage wrapper to provide
 * Effect-wrapped storage operations inside Durable Objects.
 *
 * @example
 * ```ts
 * // Inside a Durable Object
 * const storage: DOStorageBinding = state.storage
 * const effectStorage = makeStorage(storage)
 * ```
 */
export interface DOStorageBinding {
  /**
   * Delete a key from storage.
   * Can delete a single key or multiple keys.
   * Returns true/number indicating success or count of deleted keys.
   */
  delete(key: string | readonly string[]): Promise<boolean | number>;

  /**
   * Delete the current alarm.
   */
  deleteAlarm(): Promise<void>;

  /**
   * Delete all keys from storage.
   */
  deleteAll(): Promise<void>;
  /**
   * Get a value from storage.
   * Can get a single value by key or multiple values by providing an array of keys.
   */
  get<T = unknown>(
    key: string | readonly string[]
  ): Promise<T | undefined | Map<string, T>>;

  /**
   * Get the current alarm time (in milliseconds since epoch).
   * Returns null if no alarm is set.
   */
  getAlarm(): Promise<number | null>;

  /**
   * List keys in storage with optional filtering.
   */
  list<T = unknown>(options?: DOListOptions): Promise<Map<string, T>>;

  /**
   * Put a value into storage.
   * Can put a single key-value pair or multiple pairs via a Record.
   */
  put<T = unknown>(
    keyOrEntries: string | Record<string, T>,
    value?: T
  ): Promise<void>;

  /**
   * Set an alarm to trigger at a specific time.
   * @param scheduledTime - Unix timestamp in milliseconds or Date object
   */
  setAlarm(scheduledTime: number | Date): Promise<void>;

  /**
   * SQL storage interface for Durable Objects.
   * Available when the DO is configured with SQLite storage.
   */
  readonly sql?: DOSqlStorageBinding;

  /**
   * Run a transaction on storage.
   * All operations in the transaction are atomic.
   */
  transaction<T>(
    closure: (txn: DOStorageBinding) => T | Promise<T>
  ): Promise<T>;
}

/**
 * Options for listing keys in Durable Object storage.
 *
 * @property start - Start listing from this key (inclusive)
 * @property end - Stop listing at this key (exclusive)
 * @property prefix - Only list keys with this prefix
 * @property reverse - List in reverse order
 * @property limit - Maximum number of keys to return
 */
export interface DOListOptions {
  readonly end?: string;
  readonly limit?: number;
  readonly prefix?: string;
  readonly reverse?: boolean;
  readonly start?: string;
}

/**
 * Minimal structural type for SQL storage cursor.
 *
 * Represents the result of a SQL query execution. The cursor provides
 * synchronous iteration over query results.
 */
export interface DOSqlStorageCursor<T = Record<string, unknown>> {
  /**
   * Convert cursor to array of results.
   * This is a synchronous operation.
   */
  toArray(): T[];
}

/**
 * Minimal structural type for Durable Object SQLite storage.
 *
 * This type is used for DO SQL storage operations. Only available
 * when the Durable Object is configured with SQLite storage.
 *
 * @example
 * ```ts
 * // Inside a Durable Object with SQL storage
 * const sql: DOSqlStorageBinding = state.storage.sql
 * const cursor = sql.exec("SELECT * FROM users WHERE id = ?", userId)
 * const results = cursor.toArray()
 * ```
 */
export interface DOSqlStorageBinding {
  /**
   * Get the current database size in bytes.
   */
  readonly databaseSize: number;
  /**
   * Execute a SQL query and return a cursor.
   * The cursor must be converted to an array using toArray().
   */
  exec<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    ...bindings: readonly unknown[]
  ): DOSqlStorageCursor<T>;
}

// ── Target types ────────────────────────────────────────────────────────

/**
 * Discriminated union for specifying how to target a Durable Object.
 *
 * @example
 * ```ts
 * // Target by name (deterministic ID)
 * const target: DOTarget = { type: "name", name: "chat-room-123" }
 *
 * // Target by hex ID string
 * const target: DOTarget = { type: "id", id: "a1b2c3..." }
 *
 * // Create new unique instance
 * const target: DOTarget = { type: "unique" }
 * ```
 */
export type DOTarget =
  | { readonly type: "name"; readonly name: string }
  | { readonly type: "id"; readonly id: string }
  | { readonly type: "unique"; readonly jurisdiction?: string };

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * General Durable Object client-side error.
 *
 * Used when a DO client operation fails (e.g., stub creation, fetch).
 * This is an internal infrastructure error and is not serializable.
 *
 * @example
 * ```ts
 * new DOError({
 *   operation: "fetch",
 *   message: "Failed to fetch from Durable Object",
 *   cause: nativeError
 * })
 * ```
 */
export class DOError extends Data.TaggedError("DOError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Durable Object storage operation failed.
 *
 * Used when a DO storage operation (get, put, delete, list, transaction)
 * fails. This is an internal error with details about the operation.
 *
 * @example
 * ```ts
 * new StorageError({
 *   operation: "put",
 *   key: "user:123",
 *   message: "Failed to store value",
 *   cause: nativeError
 * })
 * ```
 */
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: "get" | "put" | "delete" | "list" | "transaction";
  readonly key?: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Durable Object alarm operation failed.
 *
 * Used when an alarm operation (get, set, delete) fails.
 * This is an internal infrastructure error.
 *
 * @example
 * ```ts
 * new AlarmError({
 *   operation: "set",
 *   message: "Failed to set alarm",
 *   cause: nativeError
 * })
 * ```
 */
export class AlarmError extends Data.TaggedError("AlarmError")<{
  readonly operation: "get" | "set" | "delete";
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Durable Object SQLite query failed.
 *
 * Used when a DO SQL storage query fails. Includes the query
 * and bindings for debugging.
 *
 * @example
 * ```ts
 * new SqlError({
 *   query: "SELECT * FROM users WHERE id = ?",
 *   message: "Failed to execute query",
 *   cause: nativeError
 * })
 * ```
 */
export class SqlError extends Data.TaggedError("SqlError")<{
  readonly query: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Durable Object WebSocket operation failed.
 *
 * Used when a WebSocket operation (accept, send, broadcast, close, get)
 * fails in a Durable Object context.
 *
 * @example
 * ```ts
 * new WebSocketError({
 *   operation: "accept",
 *   message: "Failed to accept WebSocket connection",
 *   cause: nativeError
 * })
 * ```
 */
export class WebSocketError extends Data.TaggedError("WebSocketError")<{
  readonly operation: "accept" | "send" | "broadcast" | "close" | "get";
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Schema constraint ──────────────────────────────────────────────────

/** A Schema that requires no external services for encoding/decoding. */
type PureSchema<A> = Schema.Schema<A> & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

// ── DOClient Service ────────────────────────────────────────────────────

/**
 * Durable Object client service.
 *
 * Provides methods for creating stubs, calling DOs, and fetching JSON responses.
 * This is the caller-side API for interacting with Durable Objects from Workers.
 *
 * @example
 * ```ts
 * // Create a client
 * const client = yield* DOClient.make()
 *
 * // Get a stub
 * const stub = yield* client.stub(env.MY_DO, { type: "name", name: "room-123" })
 *
 * // Fetch from DO
 * const response = yield* client.fetch(stub, new Request("https://do/api"))
 *
 * // Fetch JSON with schema
 * const data = yield* client.fetchJson(stub, new Request("https://do/users"), UserSchema)
 * ```
 */
export class DOClient extends ServiceMap.Service<
  DOClient,
  {
    readonly stub: (
      namespace: DONamespaceBinding,
      target: DOTarget
    ) => Effect.Effect<DurableObjectStub, DOError>;
    readonly fetch: (
      stub: DurableObjectStub,
      request: Request
    ) => Effect.Effect<Response, DOError>;
    readonly fetchJson: <A = unknown>(
      stub: DurableObjectStub,
      request: Request,
      schema?: PureSchema<A>
    ) => Effect.Effect<A, DOError | Errors.SchemaError>;
  }
>()("effectful-cloudflare/DOClient") {
  /**
   * Create a DOClient service.
   *
   * This service is stateless and provides methods for interacting with
   * Durable Objects. It does not require any bindings at construction time.
   *
   * @returns Effect that yields the DOClient service
   *
   * @example
   * ```ts
   * const client = yield* DOClient.make()
   * const stub = yield* client.stub(env.MY_DO, { type: "name", name: "chat-1" })
   * ```
   */
  static make() {
    return Effect.gen(function* () {
      // ── stub: resolve target to DurableObjectStub ─────────────────

      const stub = Effect.fn("DOClient.stub")(function* (
        namespace: DONamespaceBinding,
        target: DOTarget
      ) {
        yield* Effect.logDebug("DOClient.stub").pipe(
          Effect.annotateLogs({ targetType: target.type })
        );
        return yield* Effect.try({
          try: () => {
            let id: DurableObjectId;
            switch (target.type) {
              case "name":
                id = namespace.idFromName(target.name);
                break;
              case "id":
                id = namespace.idFromString(target.id);
                break;
              case "unique":
                id = namespace.newUniqueId(
                  target.jurisdiction
                    ? { jurisdiction: target.jurisdiction }
                    : undefined
                );
                break;
              default:
                throw new Error(
                  `Invalid target type: ${(target as { type: string }).type}`
                );
            }
            return namespace.get(id);
          },
          catch: (cause) =>
            new DOError({
              operation: "stub",
              message: "Failed to create Durable Object stub",
              cause,
            }),
        });
      });

      // ── fetch: call DO with Request ───────────────────────────────

      const fetch = Effect.fn("DOClient.fetch")(function* (
        doStub: DurableObjectStub,
        request: Request
      ) {
        yield* Effect.logDebug("DOClient.fetch").pipe(
          Effect.annotateLogs({ url: request.url })
        );
        return yield* Effect.tryPromise({
          try: () => doStub.fetch(request),
          catch: (cause) =>
            new DOError({
              operation: "fetch",
              message: "Failed to fetch from Durable Object",
              cause,
            }),
        });
      });

      // ── fetchJson: fetch + JSON decode (with optional schema) ─────

      const fetchJson = Effect.fn("DOClient.fetchJson")(function* <A = unknown>(
        doStub: DurableObjectStub,
        request: Request,
        schema?: PureSchema<A>
      ) {
        yield* Effect.logDebug("DOClient.fetchJson").pipe(
          Effect.annotateLogs({ url: request.url })
        );
        const response = yield* fetch(doStub, request);

        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) =>
            new DOError({
              operation: "fetchJson",
              message: "Failed to read response body",
              cause,
            }),
        });

        const parsed = yield* Effect.try({
          try: () => JSON.parse(text),
          catch: (cause) =>
            new DOError({
              operation: "fetchJson",
              message: "Failed to parse JSON response",
              cause,
            }),
        });

        if (!schema) {
          return parsed as A;
        }

        return yield* Effect.try({
          try: () => Schema.decodeUnknownSync(schema)(parsed) as A,
          catch: (cause) =>
            new Errors.SchemaError({
              message: "Failed to validate Durable Object fetchJson response",
              cause: cause as Error,
            }),
        });
      });

      return DOClient.of({ stub, fetch, fetchJson });
    });
  }

  /**
   * Create a layer that provides the DOClient service.
   *
   * @returns Layer providing DOClient
   *
   * @example
   * ```ts
   * const program = Effect.gen(function* () {
   *   const client = yield* DOClient
   *   const stub = yield* client.stub(env.MY_DO, { type: "name", name: "room" })
   *   return yield* client.fetch(stub, new Request("https://do/status"))
   * }).pipe(Effect.provide(DOClient.layer()))
   * ```
   */
  static layer() {
    return Layer.effect(DOClient, DOClient.make());
  }
}

// ── EffectStorage ───────────────────────────────────────────────────────

/**
 * Effect-wrapped Durable Object storage interface.
 *
 * Provides Effect-based access to Durable Object storage operations with
 * proper error handling. All methods return Effects that can fail with
 * StorageError or AlarmError.
 *
 * @example
 * ```ts
 * // Inside a Durable Object
 * const storage = makeStorage(state.storage)
 *
 * const program = Effect.gen(function* () {
 *   // Get a value
 *   const value = yield* storage.get<string>("key")
 *
 *   // Put a value
 *   yield* storage.put("key", "value")
 *
 *   // Delete a key
 *   yield* storage.delete("key")
 *
 *   // List all keys
 *   const keys = yield* storage.list()
 *
 *   // Use transactions
 *   yield* storage.transaction((txn) =>
 *     Effect.gen(function* () {
 *       yield* txn.put("key1", "value1")
 *       yield* txn.put("key2", "value2")
 *     })
 *   )
 * })
 * ```
 */
export interface EffectStorage {
  /**
   * Delete a key from storage.
   * Returns true if the key was deleted, false if it didn't exist.
   */
  readonly delete: (key: string) => Effect.Effect<boolean, StorageError>;

  /**
   * Delete the current alarm.
   */
  readonly deleteAlarm: () => Effect.Effect<void, AlarmError>;

  /**
   * Delete all keys from storage.
   */
  readonly deleteAll: () => Effect.Effect<void, StorageError>;
  /**
   * Get a value from storage by key.
   * Returns undefined if the key doesn't exist.
   */
  readonly get: <T>(key: string) => Effect.Effect<T | undefined, StorageError>;

  /**
   * Get the current alarm time (in milliseconds since epoch).
   * Returns null if no alarm is set.
   */
  readonly getAlarm: () => Effect.Effect<number | null, AlarmError>;

  /**
   * List keys in storage with optional filtering.
   */
  readonly list: <T>(
    options?: DOListOptions
  ) => Effect.Effect<Map<string, T>, StorageError>;

  /**
   * Store a value in storage.
   */
  readonly put: <T>(key: string, value: T) => Effect.Effect<void, StorageError>;

  /**
   * Set an alarm to trigger at a specific time.
   * @param scheduledTime - Unix timestamp in milliseconds or Date object
   */
  readonly setAlarm: (
    scheduledTime: number | Date
  ) => Effect.Effect<void, AlarmError>;

  /**
   * SQL storage interface (only available if DO is configured with SQLite).
   */
  readonly sql: EffectSqlStorage;

  /**
   * Run a transaction on storage.
   * All operations in the transaction are atomic.
   */
  readonly transaction: <A, E>(
    fn: (txn: EffectStorage) => Effect.Effect<A, E>
  ) => Effect.Effect<A, StorageError | E>;
}

/**
 * Effect-wrapped Durable Object SQL storage interface.
 *
 * Provides Effect-based access to Durable Object SQLite operations.
 * Only available when the Durable Object is configured with SQL storage.
 *
 * @example
 * ```ts
 * // Inside a Durable Object with SQL storage
 * const storage = makeStorage(state.storage)
 *
 * const program = Effect.gen(function* () {
 *   // Execute a query
 *   const users = yield* storage.sql.exec<User>(
 *     "SELECT * FROM users WHERE active = ?",
 *     true
 *   )
 *
 *   // Get first result
 *   const user = yield* storage.sql.execOne<User>(
 *     "SELECT * FROM users WHERE id = ?",
 *     userId
 *   )
 *
 *   // Get database size
 *   const size = yield* storage.sql.databaseSize
 * })
 * ```
 */
export interface EffectSqlStorage {
  /**
   * Get the current database size in bytes.
   */
  readonly databaseSize: Effect.Effect<number, SqlError>;
  /**
   * Execute a SQL query and return all results.
   */
  readonly exec: (
    sql: string,
    ...params: readonly unknown[]
  ) => Effect.Effect<readonly unknown[], SqlError>;

  /**
   * Execute a SQL query and return the first result.
   * Returns undefined if no results.
   */
  readonly execOne: (
    sql: string,
    ...params: readonly unknown[]
  ) => Effect.Effect<unknown | undefined, SqlError>;
}

/**
 * Create an Effect-wrapped storage interface from a Durable Object storage binding.
 *
 * This function wraps all storage operations in Effects with proper error handling.
 * All methods are traced with `Effect.fn` for observability.
 *
 * @param storage - The native Durable Object storage binding
 * @returns Effect-wrapped storage interface
 *
 * @example
 * ```ts
 * // Inside a Durable Object constructor
 * export class MyDurableObject {
 *   readonly storage: EffectStorage
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     this.storage = makeStorage(state.storage)
 *   }
 *
 *   fetch(request: Request) {
 *     return Effect.gen(function* () {
 *       const value = yield* this.storage.get<string>("key")
 *       return new Response(value ?? "not found")
 *     })
 *   }
 * }
 * ```
 */
export const makeStorage = (storage: DOStorageBinding): EffectStorage => {
  const get = Effect.fn("EffectStorage.get")(function* <T>(key: string) {
    yield* Effect.logDebug("EffectStorage.get").pipe(
      Effect.annotateLogs({ key })
    );
    return yield* Effect.tryPromise({
      try: async () => {
        const result = await storage.get<T>(key);
        // When called with a single key (string), result is T | undefined
        // When called with array, result is Map<string, T>
        // Since we only pass a single key string, we can safely cast
        return result as T | undefined;
      },
      catch: (cause) =>
        new StorageError({
          operation: "get",
          key,
          message: `Failed to get key: ${key}`,
          cause,
        }),
    });
  });

  const put = Effect.fn("EffectStorage.put")(function* <T>(
    key: string,
    value: T
  ) {
    yield* Effect.logDebug("EffectStorage.put").pipe(
      Effect.annotateLogs({ key })
    );
    return yield* Effect.tryPromise({
      try: () => storage.put(key, value),
      catch: (cause) =>
        new StorageError({
          operation: "put",
          key,
          message: `Failed to put key: ${key}`,
          cause,
        }),
    });
  });

  const del = Effect.fn("EffectStorage.delete")(function* (key: string) {
    yield* Effect.logDebug("EffectStorage.delete").pipe(
      Effect.annotateLogs({ key })
    );
    return yield* Effect.tryPromise({
      try: async () => {
        const result = await storage.delete(key);
        return typeof result === "boolean" ? result : result > 0;
      },
      catch: (cause) =>
        new StorageError({
          operation: "delete",
          key,
          message: `Failed to delete key: ${key}`,
          cause,
        }),
    });
  });

  const deleteAll = Effect.fn("EffectStorage.deleteAll")(function* () {
    yield* Effect.logDebug("EffectStorage.deleteAll");
    return yield* Effect.tryPromise({
      try: () => storage.deleteAll(),
      catch: (cause) =>
        new StorageError({
          operation: "delete",
          message: "Failed to delete all keys",
          cause,
        }),
    });
  });

  const list = Effect.fn("EffectStorage.list")(function* <T>(
    options?: DOListOptions
  ) {
    yield* Effect.logDebug("EffectStorage.list");
    return yield* Effect.tryPromise({
      try: () => storage.list<T>(options),
      catch: (cause) =>
        new StorageError({
          operation: "list",
          message: "Failed to list keys",
          cause,
        }),
    });
  });

  const getAlarm = Effect.fn("EffectStorage.getAlarm")(function* () {
    yield* Effect.logDebug("EffectStorage.getAlarm");
    return yield* Effect.tryPromise({
      try: () => storage.getAlarm(),
      catch: (cause) =>
        new AlarmError({
          operation: "get",
          message: "Failed to get alarm",
          cause,
        }),
    });
  });

  const setAlarm = Effect.fn("EffectStorage.setAlarm")(function* (
    scheduledTime: number | Date
  ) {
    yield* Effect.logDebug("EffectStorage.setAlarm").pipe(
      Effect.annotateLogs({ scheduledTime: String(scheduledTime) })
    );
    return yield* Effect.tryPromise({
      try: () => storage.setAlarm(scheduledTime),
      catch: (cause) =>
        new AlarmError({
          operation: "set",
          message: "Failed to set alarm",
          cause,
        }),
    });
  });

  const deleteAlarm = Effect.fn("EffectStorage.deleteAlarm")(function* () {
    yield* Effect.logDebug("EffectStorage.deleteAlarm");
    return yield* Effect.tryPromise({
      try: () => storage.deleteAlarm(),
      catch: (cause) =>
        new AlarmError({
          operation: "delete",
          message: "Failed to delete alarm",
          cause,
        }),
    });
  });

  const transaction = Effect.fn("EffectStorage.transaction")(function* <A, E>(
    fn: (txn: EffectStorage) => Effect.Effect<A, E>
  ) {
    yield* Effect.logDebug("EffectStorage.transaction");
    return yield* Effect.tryPromise({
      try: () =>
        storage.transaction(async (txn) => {
          const txnStorage = makeStorage(txn as unknown as DOStorageBinding);
          return await Effect.runPromise(fn(txnStorage));
        }),
      catch: (cause) =>
        new StorageError({
          operation: "transaction",
          message:
            cause instanceof Error && cause.message.includes("transaction")
              ? `Transaction failed and was rolled back: ${cause.message}`
              : "Transaction failed",
          cause,
        }),
    });
  });

  // ── SQL Storage ──────────────────────────────────────────────────────

  const exec = Effect.fn("EffectSqlStorage.exec")(function* (
    sql: string,
    ...params: readonly unknown[]
  ) {
    yield* Effect.logDebug("EffectSqlStorage.exec").pipe(
      Effect.annotateLogs({ sql: sql.slice(0, 200) })
    );
    return yield* Effect.try({
      try: () => {
        if (!storage.sql) {
          throw new Error("SQL storage not available for this Durable Object");
        }
        const cursor = storage.sql.exec(sql, ...params);
        return cursor.toArray() as readonly unknown[];
      },
      catch: (cause) =>
        new SqlError({
          query: sql,
          message: "SQL execution failed",
          cause,
        }),
    });
  });

  const execOne = Effect.fn("EffectSqlStorage.execOne")(function* (
    sql: string,
    ...params: readonly unknown[]
  ) {
    yield* Effect.logDebug("EffectSqlStorage.execOne").pipe(
      Effect.annotateLogs({ sql: sql.slice(0, 200) })
    );
    return yield* Effect.try({
      try: () => {
        if (!storage.sql) {
          throw new Error("SQL storage not available for this Durable Object");
        }
        const cursor = storage.sql.exec(sql, ...params);
        const results = cursor.toArray() as readonly unknown[];
        return results[0];
      },
      catch: (cause) =>
        new SqlError({
          query: sql,
          message: "SQL execution failed",
          cause,
        }),
    });
  });

  const databaseSize = Effect.try({
    try: () => {
      if (!storage.sql) {
        throw new Error("SQL storage not available for this Durable Object");
      }
      return storage.sql.databaseSize;
    },
    catch: (cause) =>
      new SqlError({
        query: "databaseSize",
        message: "Failed to get database size",
        cause,
      }),
  });

  const sqlStorage: EffectSqlStorage = {
    exec,
    execOne,
    databaseSize,
  };

  return {
    get,
    put,
    delete: del,
    deleteAll,
    list,
    getAlarm,
    setAlarm,
    deleteAlarm,
    transaction,
    sql: sqlStorage,
  };
};

// ── EffectDurableObject Server Base Class ─────────────────────────────────

/**
 * Abstract base class for Durable Objects with Effect support.
 *
 * This class provides a bridge between Cloudflare's Durable Object lifecycle
 * and Effect's functional programming model. It wraps all lifecycle methods
 * (fetch, alarm, WebSocket handlers) in Effects with proper error handling.
 *
 * @example
 * ```ts
 * interface Env {
 *   WORKFLOW: Workflow
 * }
 *
 * export class ContentSync extends EffectDurableObject<Env> {
 *   fetch(request: Request) {
 *     return Effect.gen(this, function* (self) {
 *       const url = new URL(request.url)
 *       if (url.pathname === "/add") {
 *         const files = yield* Effect.tryPromise(() => request.json())
 *         const pending = (yield* self.storage.get<string[]>("pending")) ?? []
 *         yield* self.storage.put("pending", [...pending, ...files])
 *
 *         const alarm = yield* self.storage.getAlarm()
 *         if (!alarm) {
 *           yield* self.storage.setAlarm(Date.now() + 10 * 60 * 1000)
 *         }
 *
 *         return new Response(JSON.stringify({ queued: pending.length + files.length }))
 *       }
 *       return new Response("Not found", { status: 404 })
 *     })
 *   }
 *
 *   alarm() {
 *     return Effect.gen(this, function* (self) {
 *       const pending = (yield* self.storage.get<string[]>("pending")) ?? []
 *       yield* self.storage.put("pending", [])
 *       if (pending.length > 0) {
 *         yield* Effect.tryPromise(() =>
 *           self.env.WORKFLOW.create({ params: { documents: pending } })
 *         )
 *       }
 *     })
 *   }
 * }
 * ```
 */
export abstract class EffectDurableObject<Env = unknown> {
  /**
   * Effect-wrapped storage interface.
   * Use this to interact with Durable Object storage.
   */
  readonly storage: EffectStorage;

  /**
   * Cloudflare environment bindings.
   * Contains all bindings defined in wrangler.toml.
   */
  readonly env: Env;

  /**
   * Unique identifier for this Durable Object instance.
   */
  readonly id: DurableObjectId;

  /**
   * Durable Object state for WebSocket hibernation API.
   * @internal
   */
  private readonly state: DurableObjectState;

  /**
   * Create a new EffectDurableObject instance.
   *
   * @param state - Cloudflare Durable Object state
   * @param env - Cloudflare environment bindings
   */
  constructor(state: DurableObjectState, env: Env) {
    this.storage = makeStorage(state.storage as unknown as DOStorageBinding);
    this.env = env;
    this.id = state.id;
    this.state = state;
  }

  /**
   * Handle HTTP requests to this Durable Object.
   *
   * CRITICAL: You must pass `this` as the first argument to `Effect.gen()` to
   * preserve context. Use the `self` parameter inside the generator to access
   * the Durable Object instance.
   *
   * @param request - The incoming HTTP request
   * @returns Effect that yields a Response
   *
   * @example
   * ```ts
   * fetch(request: Request) {
   *   return Effect.gen(this, function* (self) {
   *     const value = yield* self.storage.get("key")
   *     return new Response(value ?? "not found")
   *   })
   * }
   * ```
   */
  abstract fetch(request: Request): Effect.Effect<Response, DOError>;

  /**
   * Handle scheduled alarms.
   *
   * Called when an alarm set via `self.storage.setAlarm()` triggers.
   * Use this for deferred or batched operations.
   *
   * @returns Effect that yields void
   *
   * @example
   * ```ts
   * alarm() {
   *   return Effect.gen(this, function* (self) {
   *     const pending = (yield* self.storage.get<string[]>("pending")) ?? []
   *     yield* self.storage.put("pending", [])
   *     // Process pending items...
   *   })
   * }
   * ```
   */
  alarm?(): Effect.Effect<void, DOError>;

  /**
   * Handle WebSocket messages.
   *
   * Called when a message is received on an accepted WebSocket connection.
   * This is part of the WebSocket Hibernation API.
   *
   * @param ws - The WebSocket that received the message
   * @param message - The message data (string or ArrayBuffer)
   * @returns Effect that yields void
   *
   * @example
   * ```ts
   * webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
   *   return Effect.gen(this, function* (self) {
   *     const sockets = self.state.getWebSockets()
   *     for (const socket of sockets) {
   *       if (socket !== ws) {
   *         socket.send(typeof message === "string" ? message : "binary")
   *       }
   *     }
   *   })
   * }
   * ```
   */
  webSocketMessage?(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Effect.Effect<void, DOError>;

  /**
   * Handle WebSocket close events.
   *
   * Called when a WebSocket connection closes.
   *
   * @param ws - The WebSocket that closed
   * @param code - Close code
   * @param reason - Close reason
   * @param wasClean - Whether the close was clean
   * @returns Effect that yields void
   *
   * @example
   * ```ts
   * webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
   *   return Effect.gen(this, function* (self) {
   *     yield* Effect.logInfo(`WebSocket closed: ${code} ${reason}`)
   *   })
   * }
   * ```
   */
  webSocketClose?(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Effect.Effect<void, DOError>;

  /**
   * Handle WebSocket errors.
   *
   * Called when a WebSocket connection encounters an error.
   *
   * @param ws - The WebSocket that errored
   * @param error - The error that occurred
   * @returns Effect that yields void
   *
   * @example
   * ```ts
   * webSocketError(ws: WebSocket, error: unknown) {
   *   return Effect.gen(this, function* (self) {
   *     yield* Effect.logError("WebSocket error", error)
   *   })
   * }
   * ```
   */
  webSocketError?(ws: WebSocket, error: unknown): Effect.Effect<void, DOError>;

  /**
   * Accept a WebSocket connection for hibernation.
   *
   * This enables the WebSocket Hibernation API, allowing the Durable Object
   * to handle WebSocket messages, close, and error events via the lifecycle
   * methods above.
   *
   * @param ws - The WebSocket to accept
   * @param tags - Optional tags for filtering WebSockets
   * @returns Effect that yields void
   *
   * @example
   * ```ts
   * fetch(request: Request) {
   *   return Effect.gen(this, function* (self) {
   *     const { 0: client, 1: server } = new WebSocketPair()
   *     yield* self.acceptWebSocket(server, ["chat-room"])
   *     return new Response(null, { status: 101, webSocket: client })
   *   })
   * }
   * ```
   */
  acceptWebSocket(
    ws: WebSocket,
    tags?: readonly string[]
  ): Effect.Effect<void, WebSocketError> {
    return Effect.try({
      try: () => {
        this.state.acceptWebSocket(ws, tags as string[] | undefined);
      },
      catch: (cause) =>
        new WebSocketError({
          operation: "accept",
          message: "Failed to accept WebSocket",
          cause,
        }),
    });
  }

  /**
   * Get all accepted WebSocket connections.
   *
   * @param tag - Optional tag to filter WebSockets
   * @returns Effect that yields array of WebSockets
   *
   * @example
   * ```ts
   * webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
   *   return Effect.gen(this, function* (self) {
   *     const sockets = yield* self.getWebSockets("chat-room")
   *     for (const socket of sockets) {
   *       if (socket !== ws) {
   *         socket.send(typeof message === "string" ? message : "binary")
   *       }
   *     }
   *   })
   * }
   * ```
   */
  getWebSockets(
    tag?: string
  ): Effect.Effect<readonly WebSocket[], WebSocketError> {
    return Effect.try({
      try: () => {
        return this.state.getWebSockets(tag) as readonly WebSocket[];
      },
      catch: (cause) =>
        new WebSocketError({
          operation: "get",
          message: "Failed to get WebSockets",
          cause,
        }),
    });
  }

  /**
   * Internal bridge for Cloudflare runtime: fetch handler.
   * Converts Effect to Promise and catches all errors with Effect logging.
   * @internal
   */
  async _fetch(request: Request): Promise<Response> {
    const effect = this.fetch(request).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          yield* Effect.logError("Durable Object fetch error").pipe(
            Effect.annotateLogs({
              service: "effectful-cloudflare/DurableObject",
              operation: "fetch",
              cause: Cause.pretty(cause),
            })
          );
          return new Response("Internal Server Error", { status: 500 });
        })
      )
    );
    return await Effect.runPromise(effect);
  }

  /**
   * Internal bridge for Cloudflare runtime: alarm handler.
   * Converts Effect to Promise and logs errors via Effect logging.
   * @internal
   */
  async _alarm(): Promise<void> {
    if (!this.alarm) {
      return;
    }

    const effect = this.alarm().pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Durable Object alarm error").pipe(
          Effect.annotateLogs({
            service: "effectful-cloudflare/DurableObject",
            operation: "alarm",
            cause: Cause.pretty(cause),
          })
        )
      )
    );
    await Effect.runPromise(effect);
  }

  /**
   * Internal bridge for Cloudflare runtime: WebSocket message handler.
   * @internal
   */
  async _webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (!this.webSocketMessage) {
      return;
    }

    const effect = this.webSocketMessage(ws, message).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Durable Object WebSocket message error").pipe(
          Effect.annotateLogs({
            service: "effectful-cloudflare/DurableObject",
            operation: "webSocketMessage",
            cause: Cause.pretty(cause),
          })
        )
      )
    );
    await Effect.runPromise(effect);
  }

  /**
   * Internal bridge for Cloudflare runtime: WebSocket close handler.
   * @internal
   */
  async _webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    if (!this.webSocketClose) {
      return;
    }

    const effect = this.webSocketClose(ws, code, reason, wasClean).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Durable Object WebSocket close error").pipe(
          Effect.annotateLogs({
            service: "effectful-cloudflare/DurableObject",
            operation: "webSocketClose",
            cause: Cause.pretty(cause),
          })
        )
      )
    );
    await Effect.runPromise(effect);
  }

  /**
   * Internal bridge for Cloudflare runtime: WebSocket error handler.
   * @internal
   */
  async _webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    if (!this.webSocketError) {
      return;
    }

    const effect = this.webSocketError(ws, error).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Durable Object WebSocket error handler error").pipe(
          Effect.annotateLogs({
            service: "effectful-cloudflare/DurableObject",
            operation: "webSocketError",
            cause: Cause.pretty(cause),
          })
        )
      )
    );
    await Effect.runPromise(effect);
  }
}
