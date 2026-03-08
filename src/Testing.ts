/** biome-ignore-all lint/performance/useTopLevelRegex: Each regex is only used once */
import type { CacheBinding } from "./Cache.js";
import type {
  D1Binding,
  D1ExecResult,
  D1PreparedStatement,
  D1Result,
} from "./D1.js";
import type {
  DOListOptions,
  DOSqlStorageCursor,
  DOStorageBinding,
} from "./DurableObject.js";
import type { KVBinding } from "./KV.js";
import type { QueueBinding } from "./Queue.js";
import type {
  R2Binding,
  R2Checksums,
  R2HTTPMetadata,
  R2MultipartUpload,
  R2Object,
  R2Objects,
  R2Range,
} from "./R2.js";

// ── Internal types ──────────────────────────────────────────────────────

interface MemoryKVEntry {
  expiration?: number;
  metadata?: unknown;
  value: string;
}

// ── Helper functions ────────────────────────────────────────────────────

const nowSeconds = () => Math.floor(Date.now() / 1000);

const isExpired = (entry: MemoryKVEntry) =>
  typeof entry.expiration === "number" && entry.expiration <= nowSeconds();

// ── memoryKV ────────────────────────────────────────────────────────────

/**
 * In-memory KV implementation for testing.
 *
 * Implements the `KVBinding` structural interface with:
 * - In-memory Map storage
 * - Expiration TTL support (automatic cleanup on get/list)
 * - Metadata support
 * - Cursor-based pagination
 *
 * @returns KVBinding compatible with KV.layer() and KV.make()
 *
 * @example
 * ```ts
 * import { it } from "@effect/vitest"
 * import { Effect } from "effect"
 * import { KV } from "./KV.js"
 * import { memoryKV } from "./Testing.js"
 *
 * it.effect("stores and retrieves values", () =>
 *   Effect.gen(function*() {
 *     const kv = yield* KV
 *     yield* kv.put("key", "value")
 *     const result = yield* kv.get("key")
 *     expect(result).toBe("value")
 *   }).pipe(Effect.provide(KV.layer(memoryKV())))
 * )
 * ```
 */
export const memoryKV = (): KVBinding => {
  const store = new Map<string, MemoryKVEntry>();

  const getValue = (key: string): MemoryKVEntry | null => {
    const entry = store.get(key);
    if (!entry) {
      return null;
    }
    if (isExpired(entry)) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  const get = (
    key: string,
    _options?: { type?: string; cacheTtl?: number }
  ): Promise<string | null> => {
    const entry = getValue(key);
    return Promise.resolve(entry ? entry.value : null);
  };

  const getWithMetadata = <M = unknown>(
    key: string,
    _options?: { type?: string; cacheTtl?: number }
  ): Promise<{ value: string | null; metadata: M | null }> => {
    const entry = getValue(key);
    if (!entry) {
      return Promise.resolve({ value: null, metadata: null });
    }
    return Promise.resolve({
      value: entry.value,
      metadata: (entry.metadata as M) ?? null,
    });
  };

  const put = (
    key: string,
    value: string,
    options?: {
      expiration?: number;
      expirationTtl?: number;
      metadata?: unknown;
    }
  ): Promise<void> => {
    const expiration =
      options?.expirationTtl !== undefined
        ? nowSeconds() + options.expirationTtl
        : options?.expiration;

    const entry: MemoryKVEntry = { value };

    if (expiration !== undefined) {
      entry.expiration = expiration;
    }

    if (options?.metadata !== undefined) {
      entry.metadata = options.metadata;
    }

    store.set(key, entry);
    return Promise.resolve();
  };

  const deleteKey = (key: string): Promise<void> => {
    store.delete(key);
    return Promise.resolve();
  };

  const list = (options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: ReadonlyArray<{
      name: string;
      expiration?: number;
      metadata?: unknown;
    }>;
    list_complete: boolean;
    cursor?: string;
  }> => {
    const prefix = options?.prefix ?? undefined;
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const cursorValue =
      typeof options?.cursor === "string"
        ? Number.parseInt(options.cursor, 10)
        : 0;
    const cursor = Number.isNaN(cursorValue) ? 0 : cursorValue;

    // Filter and clean up expired entries
    const keys = Array.from(store.entries())
      .filter(([name, entry]) => {
        if (isExpired(entry)) {
          store.delete(name);
          return false;
        }
        return prefix ? name.startsWith(prefix) : true;
      })
      .map(([name, entry]) => ({
        name,
        ...(entry.expiration !== undefined
          ? { expiration: entry.expiration }
          : {}),
        ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Paginate
    const slice = keys.slice(cursor, cursor + limit);
    const nextCursor =
      cursor + slice.length < keys.length
        ? String(cursor + slice.length)
        : undefined;

    if (nextCursor === undefined) {
      return Promise.resolve({
        keys: slice,
        list_complete: true,
      });
    }

    return Promise.resolve({
      keys: slice,
      list_complete: false,
      cursor: nextCursor,
    });
  };

  return {
    get,
    getWithMetadata,
    put,
    delete: deleteKey,
    list,
  };
};

// ── memoryD1 ────────────────────────────────────────────────────────────

/**
 * In-memory D1 implementation for testing.
 *
 * Implements the `D1Binding` structural interface with:
 * - In-memory array storage for rows
 * - Basic SQL parsing (SELECT, INSERT, UPDATE, DELETE, CREATE TABLE)
 * - Support for prepared statements with parameter binding
 * - Batch operations
 * - Migration tracking table support
 *
 * **Note:** This is a simplified mock for testing. It does NOT implement:
 * - Full SQL parsing (complex queries, joins, subqueries)
 * - Transactions beyond batch
 * - Indexes or query optimization
 * - Type coercion or strict SQL validation
 *
 * @returns D1Binding compatible with D1.layer() and D1.make()
 *
 * @example
 * ```ts
 * import { it } from "@effect/vitest"
 * import { Effect } from "effect"
 * import { D1 } from "./D1.js"
 * import { memoryD1 } from "./Testing.js"
 *
 * it.effect("executes queries", () =>
 *   Effect.gen(function*() {
 *     const db = yield* D1
 *     yield* db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
 *     yield* db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')")
 *     const users = yield* db.query<{ id: number; name: string }>("SELECT * FROM users")
 *     expect(users).toHaveLength(1)
 *     expect(users[0].name).toBe("Alice")
 *   }).pipe(Effect.provide(D1.layer(memoryD1())))
 * )
 * ```
 */
export const memoryD1 = (): D1Binding => {
  // Internal storage: Map<tableName, Array<Record<string, unknown>>>
  const tables = new Map<string, Record<string, unknown>[]>();

  // Helper: parse basic SQL to extract table name and operation type
  const parseSQL = (
    sql: string
  ): { type: string; table: string | undefined } => {
    const trimmed = sql.trim().toUpperCase();

    if (trimmed.startsWith("SELECT")) {
      const fromMatch = sql.match(/FROM\s+(\w+)/i);
      return { type: "SELECT", table: fromMatch?.[1] };
    }

    if (trimmed.startsWith("INSERT")) {
      const intoMatch = sql.match(/INTO\s+(\w+)/i);
      return { type: "INSERT", table: intoMatch?.[1] };
    }

    if (trimmed.startsWith("UPDATE")) {
      const tableMatch = sql.match(/UPDATE\s+(\w+)/i);
      return { type: "UPDATE", table: tableMatch?.[1] };
    }

    if (trimmed.startsWith("DELETE")) {
      const fromMatch = sql.match(/FROM\s+(\w+)/i);
      return { type: "DELETE", table: fromMatch?.[1] };
    }

    if (trimmed.startsWith("CREATE TABLE")) {
      const tableMatch = sql.match(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i
      );
      return { type: "CREATE", table: tableMatch?.[1] };
    }

    return { type: "UNKNOWN", table: undefined };
  };

  // Helper: execute a simple INSERT
  const executeInsert = (sql: string, params: readonly unknown[]): number => {
    const parsed = parseSQL(sql);
    if (!parsed.table) {
      throw new Error("Cannot parse table name from INSERT statement");
    }

    const table = tables.get(parsed.table);
    if (!table) {
      throw new Error(`Table ${parsed.table} does not exist`);
    }

    // Extract column names from INSERT INTO table (col1, col2) VALUES (?, ?)
    const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
    if (!colsMatch?.[1]) {
      throw new Error("Cannot parse INSERT statement columns");
    }

    const columns = colsMatch[1].split(",").map((c) => c.trim());
    const row: Record<string, unknown> = {};

    columns.forEach((col, idx) => {
      const value = params[idx];
      if (value !== undefined) {
        row[col] = value;
      }
    });

    table.push(row);
    return table.length;
  };

  // Helper: execute a simple SELECT
  const executeSelect = (
    sql: string,
    params: readonly unknown[]
  ): Record<string, unknown>[] => {
    const parsed = parseSQL(sql);
    if (!parsed.table) {
      throw new Error("Cannot parse table name from SELECT statement");
    }

    const table = tables.get(parsed.table);
    if (!table) {
      return [];
    }

    // Simple WHERE clause parsing (only supports single condition like WHERE id = ?)
    const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
    if (whereMatch?.[1] && params.length > 0) {
      const column = whereMatch[1];
      const value = params[0];
      return table.filter((row) => row[column] === value);
    }

    // No WHERE clause - return all rows
    return [...table];
  };

  const prepare = (sql: string): D1PreparedStatement => {
    let boundParams: readonly unknown[] = [];

    const statement: D1PreparedStatement = {
      bind: (...values: readonly unknown[]) => {
        boundParams = values;
        return statement;
      },

      all: <T = unknown>(): Promise<D1Result<T>> => {
        const parsed = parseSQL(sql);

        if (parsed.type === "SELECT") {
          const results = executeSelect(sql, boundParams) as T[];
          return Promise.resolve({
            results,
            success: true,
            meta: {
              duration: 0,
              changes: 0,
              last_row_id: 0,
              rows_read: results.length,
              rows_written: 0,
            },
          } as D1Result<T>);
        }

        if (parsed.type === "INSERT") {
          const lastRowId = executeInsert(sql, boundParams);
          return Promise.resolve({
            results: [] as T[],
            success: true,
            meta: {
              duration: 0,
              changes: 1,
              last_row_id: lastRowId,
              rows_read: 0,
              rows_written: 1,
            },
          } as D1Result<T>);
        }

        // Default: return empty result
        return Promise.resolve({
          results: [] as T[],
          success: true,
          meta: {
            duration: 0,
            changes: 0,
            last_row_id: 0,
            rows_read: 0,
            rows_written: 0,
          },
        } as D1Result<T>);
      },

      run: (): Promise<D1Result<unknown>> => {
        const parsed = parseSQL(sql);

        if (parsed.type === "INSERT") {
          const lastRowId = executeInsert(sql, boundParams);
          return Promise.resolve({
            results: [],
            success: true,
            meta: {
              duration: 0,
              changes: 1,
              last_row_id: lastRowId,
              rows_read: 0,
              rows_written: 1,
            },
          });
        }

        // Default: success with no changes
        return Promise.resolve({
          results: [],
          success: true,
          meta: {
            duration: 0,
            changes: 0,
            last_row_id: 0,
            rows_read: 0,
            rows_written: 0,
          },
        });
      },

      first: <T = unknown>(_colName?: string): Promise<T | null> => {
        const parsed = parseSQL(sql);

        if (parsed.type === "SELECT") {
          const results = executeSelect(sql, boundParams);
          return Promise.resolve((results[0] as T) ?? null);
        }

        return Promise.resolve(null);
      },
    };

    return statement;
  };

  const batch = async <T = unknown>(
    statements: readonly D1PreparedStatement[]
  ): Promise<readonly D1Result<T>[]> => {
    const results: D1Result<T>[] = [];

    for (const stmt of statements) {
      const result = await stmt.all<T>();
      results.push(result);
    }

    return results;
  };

  // Helper: execute INSERT with literal values (from exec)
  const executeInsertLiteral = (sql: string): number => {
    const parsed = parseSQL(sql);
    if (!parsed.table) {
      throw new Error("Cannot parse table name from INSERT statement");
    }

    const table = tables.get(parsed.table);
    if (!table) {
      throw new Error(`Table ${parsed.table} does not exist`);
    }

    // Extract column names: INSERT INTO table (col1, col2) VALUES (val1, val2)
    const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
    if (!colsMatch?.[1]) {
      throw new Error("Cannot parse INSERT statement columns");
    }

    const columns = colsMatch[1].split(",").map((c) => c.trim());

    // Extract values: VALUES (val1, val2)
    const valsMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);
    if (!valsMatch?.[1]) {
      throw new Error("Cannot parse INSERT statement values");
    }

    const values = valsMatch[1].split(",").map((v) => {
      const trimmed = v.trim();
      // Parse string literals (quoted)
      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1);
      }
      // Parse numbers
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return Number(trimmed);
      }
      // Parse NULL
      if (trimmed.toUpperCase() === "NULL") {
        return null;
      }
      // Otherwise return as string
      return trimmed;
    });

    const row: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      const value = values[idx];
      if (value !== undefined) {
        row[col] = value;
      }
    });

    table.push(row);
    return table.length;
  };

  const exec = (sql: string): Promise<D1ExecResult> => {
    // Split by semicolons for multiple statements
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let count = 0;

    for (const stmt of statements) {
      const parsed = parseSQL(stmt);

      if (parsed.type === "CREATE" && parsed.table) {
        // Create table if it doesn't exist
        if (!tables.has(parsed.table)) {
          tables.set(parsed.table, []);
        }
        count++;
      } else if (parsed.type === "INSERT") {
        // Execute insert with literal values
        executeInsertLiteral(stmt);
        count++;
      } else {
        // For other statements, just count them
        count++;
      }
    }

    return Promise.resolve({
      count,
      duration: 0,
    });
  };

  const dump = (): Promise<ArrayBuffer> => {
    // Return empty ArrayBuffer for dump (not implemented)
    return Promise.resolve(new ArrayBuffer(0));
  };

  return {
    prepare,
    batch,
    exec,
    dump,
  };
};

// ── memoryR2 ────────────────────────────────────────────────────────────

/**
 * In-memory R2 implementation for testing.
 *
 * Implements the `R2Binding` structural interface with:
 * - In-memory Map storage for object data and metadata
 * - Support for get/put/delete/head/list operations
 * - HTTP metadata and custom metadata support
 * - Multipart upload support (simplified)
 * - Cursor-based pagination
 *
 * @returns R2Binding compatible with R2.layer() and R2.make()
 *
 * @example
 * ```ts
 * import { it } from "@effect/vitest"
 * import { Effect } from "effect"
 * import { R2 } from "./R2.js"
 * import { memoryR2 } from "./Testing.js"
 *
 * it.effect("stores and retrieves objects", () =>
 *   Effect.gen(function*() {
 *     const r2 = yield* R2
 *     yield* r2.put("file.txt", "Hello World")
 *     const obj = yield* r2.get("file.txt")
 *     expect(obj).not.toBeNull()
 *     const text = yield* Effect.promise(() => obj!.text())
 *     expect(text).toBe("Hello World")
 *   }).pipe(Effect.provide(R2.layer(memoryR2())))
 * )
 * ```
 */
export const memoryR2 = (): R2Binding => {
  interface StoredObject {
    checksums: R2Checksums;
    customMetadata?: Record<string, string> | undefined;
    data: ArrayBuffer;
    etag: string;
    httpEtag: string;
    httpMetadata?: R2HTTPMetadata | undefined;
    uploaded: Date;
    version: string;
  }

  const objects = new Map<string, StoredObject>();

  // Helper: convert value to ArrayBuffer
  const toArrayBuffer = async (
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob
  ): Promise<ArrayBuffer> => {
    if (value === null) {
      return new ArrayBuffer(0);
    }

    if (typeof value === "string") {
      const uint8 = new TextEncoder().encode(value);
      const buffer = uint8.buffer;
      // Ensure we return ArrayBuffer, not SharedArrayBuffer
      if (buffer instanceof ArrayBuffer) {
        return buffer.slice(
          uint8.byteOffset,
          uint8.byteOffset + uint8.byteLength
        );
      }
      // Convert SharedArrayBuffer to ArrayBuffer
      const arr = new Uint8Array(buffer, uint8.byteOffset, uint8.byteLength);
      const result = new Uint8Array(arr.byteLength);
      result.set(arr);
      return result.buffer;
    }

    if (value instanceof ArrayBuffer) {
      return value;
    }

    if (ArrayBuffer.isView(value)) {
      const buffer = value.buffer;
      // Ensure we return ArrayBuffer, not SharedArrayBuffer
      if (buffer instanceof ArrayBuffer) {
        return buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength
        );
      }
      // Convert SharedArrayBuffer to ArrayBuffer
      const sourceArr = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength
      );
      const result = new Uint8Array(sourceArr.byteLength);
      result.set(sourceArr);
      // result.buffer is guaranteed to be ArrayBuffer (not SharedArrayBuffer)
      return result.buffer as ArrayBuffer;
    }

    if (value instanceof Blob) {
      return await value.arrayBuffer();
    }

    if (value instanceof ReadableStream) {
      const response = new Response(value);
      return await response.arrayBuffer();
    }

    return new ArrayBuffer(0);
  };

  // Helper: create R2Object from stored data
  const createR2Object = (
    key: string,
    stored: StoredObject,
    range?: R2Range
  ): R2Object => {
    let data = stored.data;

    // Apply range if specified
    if (range) {
      const offset = range.offset ?? 0;
      const length = range.length ?? data.byteLength - offset;
      data = data.slice(offset, offset + length);
    }

    const baseObject: R2Object = {
      key,
      version: stored.version,
      size: data.byteLength,
      etag: stored.etag,
      httpEtag: stored.httpEtag,
      checksums: stored.checksums,
      uploaded: stored.uploaded,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(data));
          controller.close();
        },
      }),
      bodyUsed: false,
      arrayBuffer: async () => data,
      text: async () => new TextDecoder().decode(data),
      json: async () => JSON.parse(new TextDecoder().decode(data)),
      blob: async () => new Blob([data]),
      writeHttpMetadata: (headers: Headers) => {
        if (stored.httpMetadata?.contentType) {
          headers.set("Content-Type", stored.httpMetadata.contentType);
        }
        if (stored.httpMetadata?.contentLanguage) {
          headers.set("Content-Language", stored.httpMetadata.contentLanguage);
        }
        if (stored.httpMetadata?.contentDisposition) {
          headers.set(
            "Content-Disposition",
            stored.httpMetadata.contentDisposition
          );
        }
        if (stored.httpMetadata?.contentEncoding) {
          headers.set("Content-Encoding", stored.httpMetadata.contentEncoding);
        }
        if (stored.httpMetadata?.cacheControl) {
          headers.set("Cache-Control", stored.httpMetadata.cacheControl);
        }
      },
    };

    // Add optional fields only if they exist
    if (stored.httpMetadata) {
      baseObject.httpMetadata = stored.httpMetadata;
    }
    if (stored.customMetadata) {
      baseObject.customMetadata = stored.customMetadata;
    }
    if (range) {
      baseObject.range = range;
    }

    return baseObject;
  };

  const get = (
    key: string,
    options?: {
      onlyIf?:
        | { etagMatches?: string; etagDoesNotMatch?: string }
        | { uploadedBefore?: Date; uploadedAfter?: Date };
      range?: { offset?: number; length?: number; suffix?: number };
    }
  ): Promise<R2Object | null> => {
    const stored = objects.get(key);
    if (!stored) {
      return Promise.resolve(null);
    }

    // Handle onlyIf conditions
    if (options?.onlyIf) {
      const onlyIf = options.onlyIf;

      if (
        "etagMatches" in onlyIf &&
        onlyIf.etagMatches &&
        stored.etag !== onlyIf.etagMatches
      ) {
        return Promise.resolve(null);
      }

      if (
        "etagDoesNotMatch" in onlyIf &&
        onlyIf.etagDoesNotMatch &&
        stored.etag === onlyIf.etagDoesNotMatch
      ) {
        return Promise.resolve(null);
      }

      if (
        "uploadedBefore" in onlyIf &&
        onlyIf.uploadedBefore &&
        stored.uploaded >= onlyIf.uploadedBefore
      ) {
        return Promise.resolve(null);
      }

      if (
        "uploadedAfter" in onlyIf &&
        onlyIf.uploadedAfter &&
        stored.uploaded <= onlyIf.uploadedAfter
      ) {
        return Promise.resolve(null);
      }
    }

    return Promise.resolve(createR2Object(key, stored, options?.range));
  };

  const put = async (
    key: string,
    value:
      | ReadableStream
      | ArrayBuffer
      | ArrayBufferView
      | string
      | null
      | Blob,
    options?: {
      httpMetadata?: R2HTTPMetadata;
      customMetadata?: Record<string, string>;
      md5?: ArrayBuffer | string;
      sha1?: ArrayBuffer | string;
      sha256?: ArrayBuffer | string;
      sha384?: ArrayBuffer | string;
      sha512?: ArrayBuffer | string;
      storageClass?: "Standard" | "InfrequentAccess";
    }
  ): Promise<R2Object | null> => {
    const data = await toArrayBuffer(value);
    const now = new Date();
    const version = `v-${Date.now()}`;
    const etag = `"${key}-${version}"`;
    const httpEtag = etag;

    const toArrayBufferHelper = (value: ArrayBuffer | string): ArrayBuffer => {
      if (value instanceof ArrayBuffer) {
        return value;
      }
      const uint8 = new TextEncoder().encode(value);
      const result = new Uint8Array(uint8.byteLength);
      result.set(uint8);
      return result.buffer as ArrayBuffer;
    };

    const checksums: R2Checksums = {};
    if (options?.md5) {
      checksums.md5 = toArrayBufferHelper(options.md5);
    }
    if (options?.sha1) {
      checksums.sha1 = toArrayBufferHelper(options.sha1);
    }
    if (options?.sha256) {
      checksums.sha256 = toArrayBufferHelper(options.sha256);
    }
    if (options?.sha384) {
      checksums.sha384 = toArrayBufferHelper(options.sha384);
    }
    if (options?.sha512) {
      checksums.sha512 = toArrayBufferHelper(options.sha512);
    }

    const stored: StoredObject = {
      data,
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
      uploaded: now,
      version,
      etag,
      httpEtag,
      checksums,
    };

    objects.set(key, stored);

    return Promise.resolve(createR2Object(key, stored));
  };

  const deleteKeys = (keys: string | string[]): Promise<void> => {
    const keyArray = typeof keys === "string" ? [keys] : keys;

    for (const key of keyArray) {
      objects.delete(key);
    }

    return Promise.resolve();
  };

  const head = (key: string): Promise<R2Object | null> => {
    const stored = objects.get(key);
    if (!stored) {
      return Promise.resolve(null);
    }

    // Return metadata without body
    return Promise.resolve(createR2Object(key, stored));
  };

  const list = (options?: {
    prefix?: string;
    delimiter?: string;
    cursor?: string;
    limit?: number;
    include?: ("httpMetadata" | "customMetadata")[];
  }): Promise<R2Objects> => {
    const prefix = options?.prefix ?? "";
    const limit = options?.limit ?? 1000;
    const cursorValue =
      typeof options?.cursor === "string"
        ? Number.parseInt(options.cursor, 10)
        : 0;
    const cursor = Number.isNaN(cursorValue) ? 0 : cursorValue;

    // Filter by prefix
    const matching = Array.from(objects.entries())
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b));

    // Paginate
    const slice = matching.slice(cursor, cursor + limit);
    const nextCursor =
      cursor + slice.length < matching.length
        ? String(cursor + slice.length)
        : undefined;

    // Map to R2Object (without body for list operations)
    const resultObjects = slice.map(([key, stored]) =>
      createR2Object(key, stored)
    );

    const result: R2Objects = {
      objects: resultObjects,
      truncated: matching.length > cursor + limit,
      delimitedPrefixes: [],
    };

    if (nextCursor !== undefined) {
      result.cursor = nextCursor;
    }

    return Promise.resolve(result);
  };

  const createMultipartUpload = (
    key: string,
    options?: {
      httpMetadata?: R2HTTPMetadata;
      customMetadata?: Record<string, string>;
      storageClass?: "Standard" | "InfrequentAccess";
    }
  ): Promise<R2MultipartUpload> => {
    const uploadId = `upload-${key}-${Date.now()}`;
    const parts: Array<{
      partNumber: number;
      data: ArrayBuffer;
      etag: string;
    }> = [];

    return Promise.resolve({
      key,
      uploadId,
      uploadPart: async (
        partNumber: number,
        value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob
      ) => {
        const data = await toArrayBuffer(value);
        const etag = `"part-${partNumber}-etag"`;
        parts.push({ partNumber, data, etag });
        return { partNumber, etag };
      },
      abort: (): Promise<void> => {
        // Clear parts on abort
        parts.length = 0;
        return Promise.resolve();
      },
      complete: async (
        uploadedParts: Array<{ partNumber: number; etag: string }>
      ): Promise<R2Object> => {
        // Combine parts in order
        const sortedParts = uploadedParts
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber);

        let totalSize = 0;
        const buffers: ArrayBuffer[] = [];

        for (const part of sortedParts) {
          const stored = parts.find((p) => p.partNumber === part.partNumber);
          if (stored) {
            buffers.push(stored.data);
            totalSize += stored.data.byteLength;
          }
        }

        // Concatenate all parts
        const combined = new Uint8Array(totalSize);
        let offset = 0;
        for (const buffer of buffers) {
          combined.set(new Uint8Array(buffer), offset);
          offset += buffer.byteLength;
        }

        // Store as a regular object
        const result = await put(key, combined.buffer, options);

        // Clear parts after completion
        parts.length = 0;

        if (!result) {
          throw new Error("Failed to store multipart upload result");
        }

        return result;
      },
    });
  };

  const resumeMultipartUpload = (
    key: string,
    uploadId: string
  ): R2MultipartUpload => {
    // Simplified: create new upload handle (doesn't resume actual parts)
    const parts: Array<{
      partNumber: number;
      data: ArrayBuffer;
      etag: string;
    }> = [];

    return {
      key,
      uploadId,
      uploadPart: async (
        partNumber: number,
        value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob
      ) => {
        const data = await toArrayBuffer(value);
        const etag = `"part-${partNumber}-etag"`;
        parts.push({ partNumber, data, etag });
        return { partNumber, etag };
      },
      abort: (): Promise<void> => {
        parts.length = 0;
        return Promise.resolve();
      },
      complete: async (
        uploadedParts: Array<{ partNumber: number; etag: string }>
      ): Promise<R2Object> => {
        const sortedParts = uploadedParts
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber);

        let totalSize = 0;
        const buffers: ArrayBuffer[] = [];

        for (const part of sortedParts) {
          const stored = parts.find((p) => p.partNumber === part.partNumber);
          if (stored) {
            buffers.push(stored.data);
            totalSize += stored.data.byteLength;
          }
        }

        const combined = new Uint8Array(totalSize);
        let offset = 0;
        for (const buffer of buffers) {
          combined.set(new Uint8Array(buffer), offset);
          offset += buffer.byteLength;
        }

        const result = await put(key, combined.buffer);
        parts.length = 0;

        if (!result) {
          throw new Error("Failed to store multipart upload result");
        }

        return result;
      },
    };
  };

  return {
    get,
    put,
    delete: deleteKeys,
    head,
    list,
    createMultipartUpload,
    resumeMultipartUpload,
  };
};

// ── memoryQueue ─────────────────────────────────────────────────────────

/**
 * In-memory Queue implementation for testing.
 *
 * Implements the `QueueBinding` structural interface with:
 * - In-memory array storage for messages
 * - Support for send and sendBatch operations
 * - Message options (contentType, delaySeconds)
 * - Exposed messages array for test inspection
 *
 * **Note:** This is a test mock. It does NOT:
 * - Actually delay messages based on delaySeconds
 * - Persist messages across test runs
 * - Implement queue consumer behavior
 *
 * The messages are simply stored in an array that tests can inspect to verify
 * that the expected messages were sent with the correct options.
 *
 * @returns Object with QueueBinding interface plus `messages` array for inspection
 *
 * @example
 * ```ts
 * import { it } from "@effect/vitest"
 * import { Effect } from "effect"
 * import { QueueProducer } from "./Queue.js"
 * import { memoryQueue } from "./Testing.js"
 *
 * it.effect("sends messages to queue", () =>
 *   Effect.gen(function*() {
 *     const binding = memoryQueue()
 *     const queue = yield* QueueProducer
 *
 *     yield* queue.send({ type: "test", data: "hello" })
 *     yield* queue.sendBatch([
 *       { body: { type: "task1" } },
 *       { body: { type: "task2" }, delaySeconds: 60 }
 *     ])
 *
 *     // Inspect messages that were sent
 *     expect(binding.messages).toHaveLength(3)
 *     expect(binding.messages[0].body).toEqual({ type: "test", data: "hello" })
 *     expect(binding.messages[2].delaySeconds).toBe(60)
 *   }).pipe(Effect.provide(QueueProducer.layer(binding)))
 * )
 * ```
 */
export const memoryQueue = (): QueueBinding<unknown> & {
  /**
   * Array of messages that have been sent to the queue.
   * Use this in tests to verify messages were sent correctly.
   */
  readonly messages: Array<{
    body: unknown;
    contentType?: string;
    delaySeconds?: number;
  }>;
} => {
  const messages: Array<{
    body: unknown;
    contentType?: string;
    delaySeconds?: number;
  }> = [];

  return {
    messages,

    send: <T>(
      message: T,
      options?: { contentType?: string; delaySeconds?: number }
    ): Promise<void> => {
      messages.push({
        body: message,
        ...(options?.contentType && { contentType: options.contentType }),
        ...(options?.delaySeconds !== undefined && {
          delaySeconds: options.delaySeconds,
        }),
      });
      return Promise.resolve();
    },

    sendBatch: <T>(
      batch: ReadonlyArray<{
        body: T;
        contentType?: string;
        delaySeconds?: number;
      }>
    ): Promise<void> => {
      for (const msg of batch) {
        messages.push({
          body: msg.body,
          ...(msg.contentType && { contentType: msg.contentType }),
          ...(msg.delaySeconds !== undefined && {
            delaySeconds: msg.delaySeconds,
          }),
        });
      }
      return Promise.resolve();
    },
  };
};

// ── memoryCache ─────────────────────────────────────────────────────────

/**
 * In-memory Cache implementation for testing.
 *
 * Implements the `CacheBinding` structural interface with:
 * - In-memory Map storage for Response objects
 * - Keyed by request URL
 * - Response cloning for safe storage/retrieval
 *
 * **Note:** This is a simplified mock for testing. It does NOT implement:
 * - Cache headers (Cache-Control, Expires, etc.)
 * - Cache invalidation or TTL
 * - Vary header handling
 * - Full CacheQueryOptions support (only accepts the option but doesn't use it)
 *
 * @returns CacheBinding compatible with Cache.layer() and Cache.make()
 *
 * @example
 * ```ts
 * import { it } from "@effect/vitest"
 * import { Effect } from "effect"
 * import { Cache } from "./Cache.js"
 * import { memoryCache } from "./Testing.js"
 *
 * it.effect("stores and retrieves cached responses", () =>
 *   Effect.gen(function*() {
 *     const cache = yield* Cache
 *     const response = new Response("Hello World")
 *     yield* cache.put("https://example.com", response)
 *     const cached = yield* cache.match("https://example.com")
 *     expect(cached).not.toBeNull()
 *     const text = yield* Effect.promise(() => cached!.text())
 *     expect(text).toBe("Hello World")
 *   }).pipe(Effect.provide(Cache.layer(memoryCache())))
 * )
 * ```
 */
export const memoryCache = (): CacheBinding => {
  const store = new Map<string, Response>();

  // Helper: convert Request | string | URL to cache key
  const requestKey = (request: Request | string): string => {
    if (typeof request === "string") {
      return request;
    }
    return request.url;
  };

  const match = (
    request: Request | string,
    _options?: { ignoreMethod?: boolean }
  ): Promise<Response | undefined> => {
    const key = requestKey(request);
    const cached = store.get(key);
    // Clone the response to avoid consuming the body
    return Promise.resolve(cached ? cached.clone() : undefined);
  };

  const put = (
    request: Request | string,
    response: Response
  ): Promise<void> => {
    const key = requestKey(request);
    // Clone the response to store a copy
    store.set(key, response.clone());
    return Promise.resolve();
  };

  const deleteEntry = (
    request: Request | string,
    _options?: { ignoreMethod?: boolean }
  ): Promise<boolean> => {
    const key = requestKey(request);
    return Promise.resolve(store.delete(key));
  };

  return {
    match,
    put,
    delete: deleteEntry,
  };
};

// ── memoryDOStorage ─────────────────────────────────────────────────────

/**
 * In-memory Durable Object storage implementation for testing.
 *
 * Implements the `DOStorageBinding` structural interface with:
 * - In-memory Map storage for key-value pairs
 * - Alarm support (scheduled time tracking)
 * - Transaction support (atomic operations)
 * - List operations with filtering
 * - Optional SQL storage support
 *
 * **Note:** This is a simplified mock for testing. It does NOT implement:
 * - Persistent storage across test runs
 * - Actual alarm execution (only tracks scheduled time)
 * - Full SQL parsing (only basic exec/execOne operations)
 *
 * @param options - Optional configuration
 * @param options.enableSql - Enable SQL storage support (default: false)
 * @returns DOStorageBinding compatible with EffectDurableObject and makeStorage()
 *
 * @example
 * ```ts
 * import { it } from "@effect/vitest"
 * import { Effect } from "effect"
 * import { makeStorage } from "./DurableObject.js"
 * import { memoryDOStorage } from "./Testing.js"
 *
 * it.effect("stores and retrieves values in DO storage", () =>
 *   Effect.gen(function*() {
 *     const storage = makeStorage(memoryDOStorage())
 *
 *     yield* storage.put("key", "value")
 *     const result = yield* storage.get<string>("key")
 *     expect(result).toBe("value")
 *
 *     yield* storage.setAlarm(Date.now() + 60000)
 *     const alarm = yield* storage.getAlarm()
 *     expect(alarm).toBeGreaterThan(0)
 *   })
 * )
 * ```
 */
export const memoryDOStorage = (options?: {
  enableSql?: boolean;
}): DOStorageBinding => {
  const store = new Map<string, unknown>();
  let alarmTime: number | null = null;

  // SQL storage (optional)
  const sqlStore = new Map<string, Record<string, unknown>[]>();
  let sqlDatabaseSize = 0;

  const get = <T = unknown>(
    key: string | readonly string[]
  ): Promise<T | undefined | Map<string, T>> => {
    if (typeof key === "string") {
      // Single key lookup
      return Promise.resolve(store.get(key) as T | undefined);
    }

    // Multiple keys lookup - return Map
    const result = new Map<string, T>();
    for (const k of key) {
      const value = store.get(k);
      if (value !== undefined) {
        result.set(k, value as T);
      }
    }
    return Promise.resolve(result);
  };

  const put = <T = unknown>(
    keyOrEntries: string | Record<string, T>,
    value?: T
  ): Promise<void> => {
    if (typeof keyOrEntries === "string") {
      // Single key-value put
      if (value !== undefined) {
        store.set(keyOrEntries, value);
      }
    } else {
      // Multiple entries put
      for (const [k, v] of Object.entries(keyOrEntries)) {
        store.set(k, v);
      }
    }
    return Promise.resolve();
  };

  const deleteKey = (
    key: string | readonly string[]
  ): Promise<boolean | number> => {
    if (typeof key === "string") {
      // Single key delete
      return Promise.resolve(store.delete(key));
    }

    // Multiple keys delete - return count
    let count = 0;
    for (const k of key) {
      if (store.delete(k)) {
        count++;
      }
    }
    return Promise.resolve(count);
  };

  const deleteAll = (): Promise<void> => {
    store.clear();
    return Promise.resolve();
  };

  const list = <T = unknown>(
    options?: DOListOptions
  ): Promise<Map<string, T>> => {
    const prefix = options?.prefix;
    const start = options?.start;
    const end = options?.end;
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const reverse = options?.reverse ?? false;

    // Filter keys
    let keys = Array.from(store.keys());

    if (prefix) {
      keys = keys.filter((k) => k.startsWith(prefix));
    }

    if (start) {
      keys = keys.filter((k) => k >= start);
    }

    if (end) {
      keys = keys.filter((k) => k < end);
    }

    // Sort
    keys.sort();
    if (reverse) {
      keys.reverse();
    }

    // Limit
    keys = keys.slice(0, limit);

    // Build result Map
    const result = new Map<string, T>();
    for (const key of keys) {
      const value = store.get(key);
      if (value !== undefined) {
        result.set(key, value as T);
      }
    }

    return Promise.resolve(result);
  };

  const getAlarm = (): Promise<number | null> => {
    return Promise.resolve(alarmTime);
  };

  const setAlarm = (scheduledTime: number | Date): Promise<void> => {
    alarmTime =
      scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
    return Promise.resolve();
  };

  const deleteAlarm = (): Promise<void> => {
    alarmTime = null;
    return Promise.resolve();
  };

  const transaction = async <T>(
    closure: (txn: DOStorageBinding) => T | Promise<T>
  ): Promise<T> => {
    // Simple transaction: create a snapshot, run closure, commit or rollback
    const snapshot = new Map(store);

    try {
      // Create a transaction binding that operates on the current store
      const txnBinding: DOStorageBinding = {
        get,
        put,
        delete: deleteKey,
        deleteAll,
        list,
        getAlarm,
        setAlarm,
        deleteAlarm,
        transaction,
        ...(options?.enableSql && sqlStorage ? { sql: sqlStorage } : {}),
      };

      const result = await closure(txnBinding);
      // Commit: store is already modified
      return result;
    } catch (error) {
      // Rollback: restore snapshot
      store.clear();
      for (const [k, v] of snapshot.entries()) {
        store.set(k, v);
      }
      throw error;
    }
  };

  // SQL storage implementation (simplified)
  const createEmptyCursor = <
    T extends Record<string, unknown>,
  >(): DOSqlStorageCursor<T> => ({
    toArray: (): T[] => [],
  });

  const handleCreateTable = (query: string): void => {
    const match = query.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i
    );
    if (match?.[1]) {
      const tableName = match[1];
      if (!sqlStore.has(tableName)) {
        sqlStore.set(tableName, []);
      }
      sqlDatabaseSize += 100;
    }
  };

  const handleSelect = <T extends Record<string, unknown>>(
    query: string
  ): DOSqlStorageCursor<T> => {
    const fromMatch = query.match(/FROM\s+(\w+)/i);
    if (fromMatch?.[1]) {
      const tableName = fromMatch[1];
      const table = sqlStore.get(tableName) ?? [];
      return {
        toArray: (): T[] => table as T[],
      };
    }
    return createEmptyCursor<T>();
  };

  const handleInsert = (): void => {
    sqlDatabaseSize += 50;
  };

  const sqlStorage = options?.enableSql
    ? {
        get databaseSize(): number {
          return sqlDatabaseSize;
        },
        exec<T extends Record<string, unknown> = Record<string, unknown>>(
          query: string,
          ..._bindings: readonly unknown[]
        ): DOSqlStorageCursor<T> {
          const trimmed = query.trim().toUpperCase();

          if (trimmed.startsWith("CREATE TABLE")) {
            handleCreateTable(query);
            return createEmptyCursor<T>();
          }

          if (trimmed.startsWith("SELECT")) {
            return handleSelect<T>(query);
          }

          if (trimmed.startsWith("INSERT")) {
            handleInsert();
            return createEmptyCursor<T>();
          }

          return createEmptyCursor<T>();
        },
      }
    : undefined;

  return {
    get,
    put,
    delete: deleteKey,
    deleteAll,
    list,
    getAlarm,
    setAlarm,
    deleteAlarm,
    transaction,
    ...(sqlStorage ? { sql: sqlStorage } : {}),
  };
};
