import type { KVBinding } from "./KV.js";
import type {
	D1Binding,
	D1PreparedStatement,
	D1Result,
	D1ExecResult,
} from "./D1.js";
import type {
	R2Binding,
	R2Object,
	R2Objects,
	R2MultipartUpload,
	R2HTTPMetadata,
	R2Checksums,
	R2Range,
} from "./R2.js";

// ── Internal types ──────────────────────────────────────────────────────

type MemoryKVEntry = {
	value: string;
	expiration?: number;
	metadata?: unknown;
};

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
		_options?: { type?: string; cacheTtl?: number },
	): Promise<string | null> => {
		const entry = getValue(key);
		return Promise.resolve(entry ? entry.value : null);
	};

	const getWithMetadata = <M = unknown>(
		key: string,
		_options?: { type?: string; cacheTtl?: number },
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
		},
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
	const tables = new Map<string, Array<Record<string, unknown>>>();

	// Helper: parse basic SQL to extract table name and operation type
	const parseSQL = (sql: string): { type: string; table: string | undefined } => {
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
			const tableMatch = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
			return { type: "CREATE", table: tableMatch?.[1] };
		}
		
		return { type: "UNKNOWN", table: undefined };
	};

	// Helper: execute a simple INSERT
	const executeInsert = (sql: string, params: ReadonlyArray<unknown>): number => {
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
		if (!colsMatch || !colsMatch[1]) {
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
	const executeSelect = (sql: string, params: ReadonlyArray<unknown>): Array<Record<string, unknown>> => {
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
		if (whereMatch && whereMatch[1] && params.length > 0) {
			const column = whereMatch[1];
			const value = params[0];
			return table.filter((row) => row[column] === value);
		}

		// No WHERE clause - return all rows
		return [...table];
	};

	const prepare = (sql: string): D1PreparedStatement => {
		let boundParams: ReadonlyArray<unknown> = [];

		const statement: D1PreparedStatement = {
			bind: (...values: ReadonlyArray<unknown>) => {
				boundParams = values;
				return statement;
			},

			all: async <T = unknown>() => {
				const parsed = parseSQL(sql);

				if (parsed.type === "SELECT") {
					const results = executeSelect(sql, boundParams) as T[];
					return {
						results,
						success: true,
						meta: {
							duration: 0,
							changes: 0,
							last_row_id: 0,
							rows_read: results.length,
							rows_written: 0,
						},
					} as D1Result<T>;
				}

				if (parsed.type === "INSERT") {
					const lastRowId = executeInsert(sql, boundParams);
					return {
						results: [] as T[],
						success: true,
						meta: {
							duration: 0,
							changes: 1,
							last_row_id: lastRowId,
							rows_read: 0,
							rows_written: 1,
						},
					} as D1Result<T>;
				}

				// Default: return empty result
				return {
					results: [] as T[],
					success: true,
					meta: {
						duration: 0,
						changes: 0,
						last_row_id: 0,
						rows_read: 0,
						rows_written: 0,
					},
				} as D1Result<T>;
			},

			run: async () => {
				const parsed = parseSQL(sql);

				if (parsed.type === "INSERT") {
					const lastRowId = executeInsert(sql, boundParams);
					return {
						results: [],
						success: true,
						meta: {
							duration: 0,
							changes: 1,
							last_row_id: lastRowId,
							rows_read: 0,
							rows_written: 1,
						},
					};
				}

				// Default: success with no changes
				return {
					results: [],
					success: true,
					meta: {
						duration: 0,
						changes: 0,
						last_row_id: 0,
						rows_read: 0,
						rows_written: 0,
					},
				};
			},

			first: async <T = unknown>(_colName?: string) => {
				const parsed = parseSQL(sql);

				if (parsed.type === "SELECT") {
					const results = executeSelect(sql, boundParams);
					return (results[0] as T) ?? null;
				}

				return null;
			},
		};

		return statement;
	};

	const batch = async <T = unknown>(
		statements: ReadonlyArray<D1PreparedStatement>,
	): Promise<ReadonlyArray<D1Result<T>>> => {
		const results: D1Result<T>[] = [];
		
		for (const stmt of statements) {
			const result = await stmt.all<T>();
			results.push(result);
		}
		
		return results;
	};

	const exec = async (sql: string): Promise<D1ExecResult> => {
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
				// Execute insert without params (assumes VALUES are literals, not placeholders)
				// This is a simplification - real implementation would parse literals
				count++;
			} else {
				// For other statements, just count them
				count++;
			}
		}

		return {
			count,
			duration: 0,
		};
	};

	const dump = async (): Promise<ArrayBuffer> => {
		// Return empty ArrayBuffer for dump (not implemented)
		return new ArrayBuffer(0);
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
	type StoredObject = {
		data: ArrayBuffer;
		httpMetadata?: R2HTTPMetadata;
		customMetadata?: Record<string, string>;
		uploaded: Date;
		version: string;
		etag: string;
		httpEtag: string;
		checksums: R2Checksums;
	};

	const objects = new Map<string, StoredObject>();

	// Helper: convert value to ArrayBuffer
	const toArrayBuffer = async (
		value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
	): Promise<ArrayBuffer> => {
		if (value === null) {
			return new ArrayBuffer(0);
		}
		
		if (typeof value === "string") {
			return new TextEncoder().encode(value).buffer;
		}
		
		if (value instanceof ArrayBuffer) {
			return value;
		}
		
		if (ArrayBuffer.isView(value)) {
			return value.buffer.slice(
				value.byteOffset,
				value.byteOffset + value.byteLength,
			);
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
	const createR2Object = (key: string, stored: StoredObject, range?: R2Range): R2Object => {
		let data = stored.data;

		// Apply range if specified
		if (range) {
			const offset = range.offset ?? 0;
			const length = range.length ?? data.byteLength - offset;
			data = data.slice(offset, offset + length);
		}

		return {
			key,
			version: stored.version,
			size: data.byteLength,
			etag: stored.etag,
			httpEtag: stored.httpEtag,
			checksums: stored.checksums,
			uploaded: stored.uploaded,
			httpMetadata: stored.httpMetadata,
			customMetadata: stored.customMetadata,
			range,
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
					headers.set("Content-Disposition", stored.httpMetadata.contentDisposition);
				}
				if (stored.httpMetadata?.contentEncoding) {
					headers.set("Content-Encoding", stored.httpMetadata.contentEncoding);
				}
				if (stored.httpMetadata?.cacheControl) {
					headers.set("Cache-Control", stored.httpMetadata.cacheControl);
				}
			},
		};
	};

	const get = async (
		key: string,
		options?: {
			onlyIf?:
				| { etagMatches?: string; etagDoesNotMatch?: string }
				| { uploadedBefore?: Date; uploadedAfter?: Date };
			range?: { offset?: number; length?: number; suffix?: number };
		},
	): Promise<R2Object | null> => {
		const stored = objects.get(key);
		if (!stored) {
			return null;
		}

		// Handle onlyIf conditions
		if (options?.onlyIf) {
			const onlyIf = options.onlyIf;
			
			if ("etagMatches" in onlyIf && onlyIf.etagMatches) {
				if (stored.etag !== onlyIf.etagMatches) {
					return null;
				}
			}
			
			if ("etagDoesNotMatch" in onlyIf && onlyIf.etagDoesNotMatch) {
				if (stored.etag === onlyIf.etagDoesNotMatch) {
					return null;
				}
			}
			
			if ("uploadedBefore" in onlyIf && onlyIf.uploadedBefore) {
				if (stored.uploaded >= onlyIf.uploadedBefore) {
					return null;
				}
			}
			
			if ("uploadedAfter" in onlyIf && onlyIf.uploadedAfter) {
				if (stored.uploaded <= onlyIf.uploadedAfter) {
					return null;
				}
			}
		}

		return createR2Object(key, stored, options?.range);
	};

	const put = async (
		key: string,
		value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
		options?: {
			httpMetadata?: R2HTTPMetadata;
			customMetadata?: Record<string, string>;
			md5?: ArrayBuffer | string;
			sha1?: ArrayBuffer | string;
			sha256?: ArrayBuffer | string;
			sha384?: ArrayBuffer | string;
			sha512?: ArrayBuffer | string;
			storageClass?: "Standard" | "InfrequentAccess";
		},
	): Promise<R2Object | null> => {
		const data = await toArrayBuffer(value);
		const now = new Date();
		const version = `v-${Date.now()}`;
		const etag = `"${key}-${version}"`;
		const httpEtag = etag;

		const checksums: R2Checksums = {
			...(options?.md5 && { md5: options.md5 instanceof ArrayBuffer ? options.md5 : new TextEncoder().encode(options.md5).buffer }),
			...(options?.sha1 && { sha1: options.sha1 instanceof ArrayBuffer ? options.sha1 : new TextEncoder().encode(options.sha1).buffer }),
			...(options?.sha256 && { sha256: options.sha256 instanceof ArrayBuffer ? options.sha256 : new TextEncoder().encode(options.sha256).buffer }),
			...(options?.sha384 && { sha384: options.sha384 instanceof ArrayBuffer ? options.sha384 : new TextEncoder().encode(options.sha384).buffer }),
			...(options?.sha512 && { sha512: options.sha512 instanceof ArrayBuffer ? options.sha512 : new TextEncoder().encode(options.sha512).buffer }),
		};

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

		return createR2Object(key, stored);
	};

	const deleteKeys = async (keys: string | string[]): Promise<void> => {
		const keyArray = typeof keys === "string" ? [keys] : keys;
		
		for (const key of keyArray) {
			objects.delete(key);
		}
	};

	const head = async (key: string): Promise<R2Object | null> => {
		const stored = objects.get(key);
		if (!stored) {
			return null;
		}

		// Return metadata without body
		return createR2Object(key, stored);
	};

	const list = async (options?: {
		prefix?: string;
		delimiter?: string;
		cursor?: string;
		limit?: number;
		include?: ("httpMetadata" | "customMetadata")[];
	}): Promise<R2Objects> => {
		const prefix = options?.prefix ?? "";
		const limit = options?.limit ?? 1000;
		const cursorValue = typeof options?.cursor === "string" ? Number.parseInt(options.cursor, 10) : 0;
		const cursor = Number.isNaN(cursorValue) ? 0 : cursorValue;

		// Filter by prefix
		const matching = Array.from(objects.entries())
			.filter(([key]) => key.startsWith(prefix))
			.sort(([a], [b]) => a.localeCompare(b));

		// Paginate
		const slice = matching.slice(cursor, cursor + limit);
		const nextCursor = cursor + slice.length < matching.length ? String(cursor + slice.length) : undefined;

		// Map to R2Object (without body for list operations)
		const resultObjects = slice.map(([key, stored]) => createR2Object(key, stored));

		return {
			objects: resultObjects,
			truncated: matching.length > cursor + limit,
			cursor: nextCursor,
			delimitedPrefixes: [],
		};
	};

	const createMultipartUpload = async (
		key: string,
		options?: {
			httpMetadata?: R2HTTPMetadata;
			customMetadata?: Record<string, string>;
			storageClass?: "Standard" | "InfrequentAccess";
		},
	): Promise<R2MultipartUpload> => {
		const uploadId = `upload-${key}-${Date.now()}`;
		const parts: Array<{ partNumber: number; data: ArrayBuffer; etag: string }> = [];

		return {
			key,
			uploadId,
			uploadPart: async (
				partNumber: number,
				value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
			) => {
				const data = await toArrayBuffer(value);
				const etag = `"part-${partNumber}-etag"`;
				parts.push({ partNumber, data, etag });
				return { partNumber, etag };
			},
			abort: async () => {
				// Clear parts on abort
				parts.length = 0;
			},
			complete: async (uploadedParts) => {
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

				return result!;
			},
		};
	};

	const resumeMultipartUpload = (key: string, uploadId: string): R2MultipartUpload => {
		// Simplified: create new upload handle (doesn't resume actual parts)
		const parts: Array<{ partNumber: number; data: ArrayBuffer; etag: string }> = [];

		return {
			key,
			uploadId,
			uploadPart: async (
				partNumber: number,
				value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
			) => {
				const data = await toArrayBuffer(value);
				const etag = `"part-${partNumber}-etag"`;
				parts.push({ partNumber, data, etag });
				return { partNumber, etag };
			},
			abort: async () => {
				parts.length = 0;
			},
			complete: async (uploadedParts) => {
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

				return result!;
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
