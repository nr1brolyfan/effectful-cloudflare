import { Data } from "effect";

// ── Binding types ──────────────────────────────────────────────────────

/**
 * D1 prepared statement interface.
 *
 * Represents a prepared SQL statement that can be bound with parameters
 * and executed against a D1 database.
 */
export type D1PreparedStatement = {
	readonly bind: (...values: ReadonlyArray<unknown>) => D1PreparedStatement;
	readonly all: <T = unknown>() => Promise<D1Result<T>>;
	readonly run: () => Promise<D1Result>;
	readonly first: <T = unknown>(colName?: string) => Promise<T | null>;
};

/**
 * Result from a D1 query operation.
 *
 * @property results - Array of row objects returned by the query
 * @property success - Whether the query executed successfully
 * @property meta - Query execution metadata (duration, changes, etc.)
 */
export type D1Result<T = unknown> = {
	readonly results: ReadonlyArray<T>;
	readonly success: boolean;
	readonly meta: {
		readonly duration: number;
		readonly changes: number;
		readonly last_row_id: number;
		readonly rows_read: number;
		readonly rows_written: number;
	};
};

/**
 * Result from D1 exec operation.
 *
 * @property count - Number of statements executed
 * @property duration - Total execution time in milliseconds
 */
export type D1ExecResult = {
	readonly count: number;
	readonly duration: number;
};

/**
 * Minimal structural type for D1Database binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It extracts only the methods
 * we need from the native D1Database interface.
 *
 * @example
 * ```ts
 * // Use with native Cloudflare binding
 * const binding: D1Binding = env.MY_DB
 *
 * // Or use with test mock
 * const binding: D1Binding = Testing.memoryD1()
 * ```
 */
export type D1Binding = {
	prepare(sql: string): D1PreparedStatement;
	batch<T = unknown>(
		statements: ReadonlyArray<D1PreparedStatement>,
	): Promise<ReadonlyArray<D1Result<T>>>;
	exec(sql: string): Promise<D1ExecResult>;
	dump(): Promise<ArrayBuffer>;
};

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * D1 operation failed.
 *
 * General D1 database error wrapping Cloudflare D1 exceptions.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new D1Error({
 *   operation: "exec",
 *   message: "Failed to execute SQL",
 *   cause: nativeError
 * })
 * ```
 */
export class D1Error extends Data.TaggedError("D1Error")<{
	readonly operation: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

/**
 * D1 query failed.
 *
 * Query-specific error that includes the SQL statement and parameters
 * for debugging purposes. This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new D1QueryError({
 *   sql: "SELECT * FROM users WHERE id = ?",
 *   params: [123],
 *   message: "Query execution failed",
 *   cause: nativeError
 * })
 * ```
 */
export class D1QueryError extends Data.TaggedError("D1QueryError")<{
	readonly sql: string;
	readonly params?: ReadonlyArray<unknown>;
	readonly message: string;
	readonly cause?: unknown;
}> {}

/**
 * D1 migration failed.
 *
 * Migration-specific error that includes the migration name for debugging.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new D1MigrationError({
 *   migrationName: "001_create_users_table",
 *   message: "Migration failed to apply",
 *   cause: nativeError
 * })
 * ```
 */
export class D1MigrationError extends Data.TaggedError("D1MigrationError")<{
	readonly migrationName?: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}
