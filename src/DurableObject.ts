import { Data } from "effect";

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
 * Minimal structural type for Durable Object SQLite storage.
 *
 * This type is used for DO SQL storage operations. Only available
 * when the Durable Object is configured with SQLite storage.
 *
 * @example
 * ```ts
 * // Inside a Durable Object with SQL storage
 * const sql: DOSqlStorageBinding = state.storage.sql
 * const results = await sql.exec("SELECT * FROM users WHERE id = ?", userId)
 * ```
 */
export interface DOSqlStorageBinding {
  /**
   * Get the current database size in bytes.
   */
  readonly databaseSize: number;
  /**
   * Execute a SQL query and return all results.
   */
  exec<T = unknown>(
    query: string,
    ...bindings: readonly unknown[]
  ): Promise<readonly T[]>;
}

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
