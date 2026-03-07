import type { KVBinding } from "./KV.js";

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
