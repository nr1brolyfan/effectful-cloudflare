/**
 * @module Hyperdrive
 *
 * Effect-wrapped Cloudflare Hyperdrive connection pooling.
 *
 * Provides access to Hyperdrive's connection string and connection info for
 * database drivers. Hyperdrive accelerates database connections by caching
 * and pooling TCP connections at the Cloudflare edge.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Hyperdrive } from "effectful-cloudflare/Hyperdrive"
 *
 * const program = Effect.gen(function*() {
 *   const hd = yield* Hyperdrive
 *   const connStr = yield* hd.connectionString
 *   // Pass connStr to your database driver
 * }).pipe(Effect.provide(Hyperdrive.layer(env.MY_HYPERDRIVE)))
 * ```
 */

import { Data, Effect, Layer, ServiceMap } from "effect";

// ── Binding type ───────────────────────────────────────────────────────

/**
 * Minimal structural type for Hyperdrive binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It extracts only the properties
 * we need from the native Hyperdrive interface.
 *
 * Hyperdrive provides connection pooling and query caching for PostgreSQL databases.
 * All properties are readonly and synchronously accessible.
 *
 * @example
 * ```ts
 * // Use with native Cloudflare binding
 * const binding: HyperdriveBinding = env.MY_HYPERDRIVE
 *
 * // Or use with test mock
 * const binding: HyperdriveBinding = {
 *   connectionString: "postgresql://user:pass@host:5432/db",
 *   host: "host",
 *   port: 5432,
 *   user: "user",
 *   password: "pass",
 *   database: "db"
 * }
 * ```
 */
export interface HyperdriveBinding {
  readonly connectionString: string;
  readonly database: string;
  readonly host: string;
  readonly password: string;
  readonly port: number;
  readonly user: string;
}

// ── Result types ───────────────────────────────────────────────────────

/**
 * Connection information extracted from Hyperdrive binding.
 *
 * This is a simplified representation of the connection details without
 * sensitive credentials.
 *
 * @example
 * ```ts
 * const info: HyperdriveConnectionInfo = {
 *   host: "db.example.com",
 *   port: 5432,
 *   database: "myapp_production"
 * }
 * ```
 */
export interface HyperdriveConnectionInfo {
  readonly database: string;
  readonly host: string;
  readonly port: number;
}

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * Hyperdrive operation failed.
 *
 * Module-specific error for Hyperdrive access failures. This is an internal
 * error and is not serializable.
 *
 * @example
 * ```ts
 * new HyperdriveError({
 *   operation: "connectionString",
 *   message: "Failed to read connection string from binding",
 *   cause: nativeError
 * })
 * ```
 */
export class HyperdriveError extends Data.TaggedError("HyperdriveError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Service ─────────────────────────────────────────────────────────────

/**
 * Hyperdrive service for PostgreSQL connection pooling and query caching.
 *
 * Provides access to connection details from a Hyperdrive binding. All methods
 * use `Effect.fn` for automatic tracing and return proper Effect types.
 *
 * Hyperdrive is designed for use with PostgreSQL clients like `@neondatabase/serverless`
 * or `effect-pg`. Use the connection string to initialize your database client.
 *
 * @example
 * ```ts
 * import { Hyperdrive } from "effectful-cloudflare/Hyperdrive"
 * import { Effect } from "effect"
 *
 * const program = Effect.gen(function*() {
 *   const hyperdrive = yield* Hyperdrive
 *
 *   // Get full connection string
 *   const connString = yield* hyperdrive.connectionString
 *   console.log(connString) // "postgresql://user:pass@host:5432/db"
 *
 *   // Get connection info without credentials
 *   const info = yield* hyperdrive.connectionInfo
 *   console.log(info.host, info.port, info.database)
 * }).pipe(Effect.provide(Hyperdrive.layer(env.MY_HYPERDRIVE)))
 * ```
 */
export class Hyperdrive extends ServiceMap.Service<
  Hyperdrive,
  {
    readonly connectionString: Effect.Effect<string, HyperdriveError>;
    readonly connectionInfo: Effect.Effect<
      HyperdriveConnectionInfo,
      HyperdriveError
    >;
  }
>()("effectful-cloudflare/Hyperdrive") {
  /**
   * Create a Hyperdrive service instance from a binding.
   *
   * All operations are synchronous reads from the binding object.
   * Uses `Effect.try` instead of `Effect.tryPromise` for sync access.
   *
   * @param binding - The Hyperdrive binding from Cloudflare Workers environment
   * @returns Effect that yields a Hyperdrive service instance
   *
   * @example
   * ```ts
   * const service = yield* Hyperdrive.make(env.MY_HYPERDRIVE)
   * ```
   */
  static make = Effect.fn("Hyperdrive.make")(function* (
    binding: HyperdriveBinding
  ) {
    // connectionString getter - synchronous read from binding
    const connectionString = Effect.gen(function* () {
      yield* Effect.logDebug("Hyperdrive.connectionString");
      return yield* Effect.try({
        try: () => binding.connectionString,
        catch: (cause) =>
          new HyperdriveError({
            operation: "connectionString",
            message: "Failed to read connection string from binding",
            cause,
          }),
      });
    }).pipe(Effect.withSpan("Hyperdrive.connectionString"));

    // connectionInfo getter - synchronous read of connection details
    const connectionInfo = Effect.gen(function* () {
      yield* Effect.logDebug("Hyperdrive.connectionInfo");
      return yield* Effect.try({
        try: () => ({
          host: binding.host,
          port: binding.port,
          database: binding.database,
        }),
        catch: (cause) =>
          new HyperdriveError({
            operation: "connectionInfo",
            message: "Failed to read connection info from binding",
            cause,
          }),
      });
    }).pipe(Effect.withSpan("Hyperdrive.connectionInfo"));

    return Hyperdrive.of({
      connectionString,
      connectionInfo,
    });
  });

  /**
   * Create a Hyperdrive service layer.
   *
   * @param binding - The Hyperdrive binding from Cloudflare Workers environment
   * @returns Layer that provides the Hyperdrive service
   *
   * @example
   * ```ts
   * const HyperdriveLive = Hyperdrive.layer(env.MY_HYPERDRIVE)
   *
   * const program = Effect.gen(function*() {
   *   const hyperdrive = yield* Hyperdrive
   *   // use hyperdrive...
   * }).pipe(Effect.provide(HyperdriveLive))
   * ```
   */
  static layer = (binding: HyperdriveBinding) =>
    Layer.effect(this, this.make(binding));
}
