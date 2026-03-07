import { Data, Effect, Layer, Schema, ServiceMap } from "effect";
import * as Errors from "./Errors.js";

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

// ── D1 Service ─────────────────────────────────────────────────────────

/**
 * D1 service — Effect-wrapped Cloudflare Workers D1 database.
 *
 * Provides Effect-based operations for Cloudflare Workers D1 SQL database with:
 * - Automatic error handling and typed errors
 * - Schema validation support for query results
 * - Batch operations and migrations
 * - Automatic tracing with `Effect.fn`
 *
 * @example
 * ```ts
 * // Single instance
 * const d1Layer = D1.layer(env.MY_DB)
 *
 * const program = Effect.gen(function*() {
 *   const db = yield* D1
 *   const users = yield* db.query<User>("SELECT * FROM users WHERE active = ?", [1])
 *   const user = yield* db.queryFirstOrFail("SELECT * FROM users WHERE id = ?", [123])
 * })
 *
 * // Schema-validated queries
 * const UserSchema = Schema.Struct({ id: Schema.Number, name: Schema.String })
 * const program2 = Effect.gen(function*() {
 *   const db = yield* D1
 *   const users = yield* db.querySchema(UserSchema, "SELECT * FROM users")
 * })
 * ```
 */
export class D1 extends ServiceMap.Service<
	D1,
	{
		readonly query: <T = Record<string, unknown>>(
			sql: string,
			...params: ReadonlyArray<unknown>
		) => Effect.Effect<ReadonlyArray<T>, D1QueryError>;
		readonly querySchema: <A>(
			schema: Schema.Schema<A>,
			sql: string,
			...params: ReadonlyArray<unknown>
		) => Effect.Effect<ReadonlyArray<A>, D1QueryError | Errors.SchemaError>;
		readonly queryFirst: <T = Record<string, unknown>>(
			sql: string,
			...params: ReadonlyArray<unknown>
		) => Effect.Effect<T | null, D1QueryError>;
		readonly queryFirstOrFail: <T = Record<string, unknown>>(
			sql: string,
			...params: ReadonlyArray<unknown>
		) => Effect.Effect<T, D1QueryError | Errors.NotFoundError>;
		readonly queryFirstSchema: <A>(
			schema: Schema.Schema<A>,
			sql: string,
			...params: ReadonlyArray<unknown>
		) => Effect.Effect<A | null, D1QueryError | Errors.SchemaError>;
		readonly batch: (
			statements: ReadonlyArray<D1PreparedStatement>,
		) => Effect.Effect<ReadonlyArray<D1Result>, D1Error>;
		readonly exec: (sql: string) => Effect.Effect<D1ExecResult, D1Error>;
	}
>()("effectful-cloudflare/D1") {
	/**
	 * Create a D1 service from a binding.
	 *
	 * This static method wraps all D1 operations in Effect programs with:
	 * - Automatic error handling via `Effect.tryPromise`
	 * - Typed errors (`D1QueryError`, `D1Error`, `NotFoundError`)
	 * - Automatic tracing spans via `Effect.fn`
	 *
	 * @param binding - D1 database binding from worker environment
	 * @returns Effect that yields the D1 service
	 *
	 * @example
	 * ```ts
	 * const program = Effect.gen(function*() {
	 *   const db = yield* D1.make(env.MY_DB)
	 *   const users = yield* db.query("SELECT * FROM users")
	 * })
	 * ```
	 */
	static make = (binding: D1Binding) =>
		Effect.gen(function* () {
			const query = Effect.fn("D1.query")(function* <
				T = Record<string, unknown>,
			>(sql: string, ...params: ReadonlyArray<unknown>) {
				const result = yield* Effect.tryPromise({
					try: () => binding.prepare(sql).bind(...params).all<T>(),
					catch: (cause) =>
						new D1QueryError({ sql, params, message: String(cause), cause }),
				});

				if (!result.success) {
					return yield* Effect.fail(
						new D1QueryError({
							sql,
							params,
							message: "Query execution failed",
							cause: result,
						}),
					);
				}

				return result.results;
			});

			const queryFirst = Effect.fn("D1.queryFirst")(function* <
				T = Record<string, unknown>,
			>(sql: string, ...params: ReadonlyArray<unknown>) {
				const result = yield* Effect.tryPromise({
					try: () => binding.prepare(sql).bind(...params).first<T>(),
					catch: (cause) =>
						new D1QueryError({ sql, params, message: String(cause), cause }),
				});

				return result;
			});

			const queryFirstOrFail = Effect.fn("D1.queryFirstOrFail")(function* <
				T = Record<string, unknown>,
			>(sql: string, ...params: ReadonlyArray<unknown>) {
				const result = yield* queryFirst<T>(sql, ...params);

				if (result === null) {
					return yield* Effect.fail(
						new Errors.NotFoundError({
							resource: "D1",
							key: sql,
						}),
					);
				}

				return result;
			});

			const batch = Effect.fn("D1.batch")(function* (
				statements: ReadonlyArray<D1PreparedStatement>,
			) {
				return yield* Effect.tryPromise({
					try: () => binding.batch(statements),
					catch: (cause) =>
						new D1Error({
							operation: "batch",
							message: String(cause),
							cause,
						}),
				});
			});

			const exec = Effect.fn("D1.exec")(function* (sql: string) {
				return yield* Effect.tryPromise({
					try: () => binding.exec(sql),
					catch: (cause) =>
						new D1Error({
							operation: "exec",
							message: String(cause),
							cause,
						}),
				});
			});

			// Schema-validated query methods
			const querySchema = Effect.fn("D1.querySchema")(function* <A>(
				schema: Schema.Schema<A>,
				sql: string,
				...params: ReadonlyArray<unknown>
			) {
				// Get raw results first
				const rawResults = yield* query(sql, ...params);

				// Decode each row with schema validation
				const validated = yield* Effect.forEach(rawResults, (row) =>
					Effect.mapError(
						Schema.decodeUnknownEffect(schema)(row) as Effect.Effect<
							A,
							unknown
						>,
						(cause) =>
							new Errors.SchemaError({
								message: "Schema validation failed for D1 row",
								cause: cause as Error,
							}),
					),
				);

				return validated;
			});

			const queryFirstSchema = Effect.fn("D1.queryFirstSchema")(function* <A>(
				schema: Schema.Schema<A>,
				sql: string,
				...params: ReadonlyArray<unknown>
			) {
				// Get first raw result
				const rawResult = yield* queryFirst(sql, ...params);

				// If null, return null
				if (rawResult === null) {
					return null;
				}

				// Decode the row with schema validation
				return yield* Effect.mapError(
					Schema.decodeUnknownEffect(schema)(rawResult) as Effect.Effect<
						A,
						unknown
					>,
					(cause) =>
						new Errors.SchemaError({
							message: "Schema validation failed for D1 row",
							cause: cause as Error,
						}),
				);
			});

			return D1.of({
				query,
				querySchema,
				queryFirst,
				queryFirstOrFail,
				queryFirstSchema,
				batch,
				exec,
			});
		});

	/**
	 * Create a Layer from a D1 binding.
	 *
	 * This is the standard way to provide D1 service to Effect programs.
	 *
	 * @param binding - D1 database binding from worker environment
	 * @returns Layer providing D1 service
	 *
	 * @example
	 * ```ts
	 * const layer = D1.layer(env.MY_DB)
	 *
	 * const program = Effect.gen(function*() {
	 *   const db = yield* D1
	 *   const users = yield* db.query("SELECT * FROM users")
	 * }).pipe(Effect.provide(layer))
	 * ```
	 */
	static layer = (binding: D1Binding) => Layer.effect(this, this.make(binding));
}
