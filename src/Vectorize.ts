/**
 * @module Vectorize
 *
 * Effect-wrapped Cloudflare Vectorize vector database.
 *
 * Provides a fully typed, Effect-based interface to Cloudflare Vectorize with:
 * - Vector insert, upsert, query, getByIds, deleteByIds
 * - Index metadata via `describe()`
 * - Typed errors (`VectorizeError`)
 * - Automatic tracing spans via `Effect.fn`
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Vectorize } from "effectful-cloudflare/Vectorize"
 *
 * const program = Effect.gen(function*() {
 *   const vec = yield* Vectorize
 *   yield* vec.upsert([{ id: "doc-1", values: [0.1, 0.2, 0.3] }])
 *   const results = yield* vec.query([0.1, 0.2, 0.3], { topK: 5 })
 * }).pipe(Effect.provide(Vectorize.layer(env.MY_INDEX)))
 * ```
 */

import { Data, Effect, Layer, ServiceMap } from "effect";

// ── Binding type ───────────────────────────────────────────────────────

/**
 * Minimal structural type for Vectorize Index binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It extracts only the methods
 * we need from the native VectorizeIndex interface.
 *
 * @example
 * ```ts
 * // Use with native Cloudflare binding
 * const binding: VectorizeBinding = env.MY_VECTORIZE_INDEX
 *
 * // Or use with test mock
 * const binding: VectorizeBinding = Testing.memoryVectorize()
 * ```
 */
export interface VectorizeBinding {
  deleteByIds(ids: readonly string[]): Promise<VectorizeVectorMutation>;
  describe(): Promise<VectorizeIndexDetails>;
  getByIds(ids: readonly string[]): Promise<readonly VectorizeVector[]>;
  insert(vectors: readonly VectorizeVector[]): Promise<VectorizeVectorMutation>;
  query(
    vector: VectorFloatArray | number[],
    options?: VectorizeQueryOptions
  ): Promise<VectorizeMatches>;
  upsert(vectors: readonly VectorizeVector[]): Promise<VectorizeVectorMutation>;
}

// ── Type aliases from @cloudflare/workers-types ────────────────────────

/**
 * Float32Array or Float64Array for vector values.
 */
export type VectorFloatArray = Float32Array | Float64Array;

/**
 * Metadata value types supported by Vectorize.
 */
export type VectorizeVectorMetadata =
  | string
  | number
  | boolean
  | readonly string[];

// ── Filter types ──────────────────────────────────────────────────────

/**
 * Primitive value types supported in Vectorize metadata filters.
 * Includes `null` for filtering on absent metadata fields.
 */
export type VectorizeFilterValue = string | number | boolean | null;

/**
 * Filter operator expressions for Vectorize metadata queries.
 *
 * Supports the full Cloudflare Vectorize filter syntax:
 * - `$eq` / `$ne` — equality / inequality
 * - `$lt` / `$lte` / `$gt` / `$gte` — numeric comparisons
 * - `$in` / `$nin` — set membership
 *
 * @example
 * ```ts
 * // Filter vectors where "category" equals "tech" and "score" > 0.5
 * const filter: VectorizeMetadataFilter = {
 *   category: { $eq: "tech" },
 *   score: { $gt: 0.5 },
 *   status: { $in: ["active", "pending"] }
 * }
 * ```
 */
export interface VectorizeFilterOp {
  readonly $eq?: VectorizeFilterValue;
  readonly $gt?: VectorizeFilterValue;
  readonly $gte?: VectorizeFilterValue;
  readonly $in?: readonly VectorizeFilterValue[];
  readonly $lt?: VectorizeFilterValue;
  readonly $lte?: VectorizeFilterValue;
  readonly $ne?: VectorizeFilterValue;
  readonly $nin?: readonly VectorizeFilterValue[];
}

/**
 * Full metadata filter type for Vectorize queries.
 *
 * Each key is a metadata field name. Values can be either:
 * - A direct value (shorthand for `{ $eq: value }`)
 * - An operator expression (e.g., `{ $gt: 5, $lt: 10 }`)
 *
 * @example
 * ```ts
 * // Simple equality filter (shorthand)
 * const filter: VectorizeMetadataFilter = { category: "tech", published: true }
 *
 * // Full operator syntax
 * const filter: VectorizeMetadataFilter = {
 *   category: { $eq: "tech" },
 *   score: { $gte: 0.8 },
 *   tags: { $in: ["ml", "ai"] }
 * }
 * ```
 */
export type VectorizeMetadataFilter = Record<
  string,
  VectorizeFilterValue | VectorizeFilterOp
>;

/**
 * Represents a single vector value set along with its associated metadata.
 */
export interface VectorizeVector {
  /** The ID for the vector. This can be user-defined, and must be unique. */
  readonly id: string;
  /** Metadata associated with the vector. */
  readonly metadata?: Record<string, VectorizeVectorMetadata>;
  /** The namespace this vector belongs to. */
  readonly namespace?: string;
  /** The vector values */
  readonly values: VectorFloatArray | number[];
}

/**
 * Options for vector similarity search.
 */
export interface VectorizeQueryOptions {
  /**
   * Filter by metadata.
   *
   * Supports both simple equality (shorthand) and full operator syntax:
   * - Simple: `{ category: "tech" }` — equivalent to `{ $eq: "tech" }`
   * - Operators: `{ score: { $gt: 0.5 }, tags: { $in: ["ml", "ai"] } }`
   *
   * @see VectorizeMetadataFilter for the full filter type.
   */
  readonly filter?: VectorizeMetadataFilter;
  /** The namespace to query within. */
  readonly namespace?: string;
  /** Return the metadata in the response. Default: false */
  readonly returnMetadata?: boolean;
  /** Return the vector values in the response. Default: false */
  readonly returnValues?: boolean;
  /** The number of nearest neighbors to return. Default: 5 */
  readonly topK?: number;
}

/**
 * Represents a matched vector for a query along with its score.
 */
export interface VectorizeMatch {
  /** The ID of the matched vector. */
  readonly id: string;
  /** Metadata associated with the vector (if returnMetadata: true). */
  readonly metadata?: Record<string, VectorizeVectorMetadata>;
  /** The namespace this vector belongs to. */
  readonly namespace?: string;
  /** The score or rank for similarity. */
  readonly score: number;
  /** The vector values (if returnValues: true). */
  readonly values?: VectorFloatArray | number[];
}

/**
 * Result of a vector similarity search query.
 */
export interface VectorizeMatches {
  /** Total number of matches (may be more than returned). */
  readonly count: number;
  /** Array of matched vectors with scores. */
  readonly matches: readonly VectorizeMatch[];
}

/**
 * Result of a mutation operation (insert, upsert, delete).
 *
 * Compatible with both Cloudflare's legacy `VectorizeVectorMutation`
 * (`{ ids, count }`) and the new `VectorizeAsyncMutation` (`{ mutationId }`).
 * All fields are optional to accept either shape from the binding.
 */
export interface VectorizeVectorMutation {
  /** Number of vectors that were mutated (legacy VectorizeIndex). */
  readonly count?: number;
  /** IDs of vectors that were mutated (legacy VectorizeIndex). */
  readonly ids?: readonly string[];
  /** The unique identifier for the async mutation operation (new Vectorize class). */
  readonly mutationId?: string;
}

/**
 * Index configuration.
 */
export interface VectorizeIndexConfig {
  /** Number of dimensions for vectors in this index. */
  readonly dimensions: number;
  /** Distance metric used for similarity. */
  readonly metric: "cosine" | "euclidean" | "dot-product";
}

/**
 * Metadata about an existing index.
 */
export interface VectorizeIndexDetails {
  /** The index configuration. */
  readonly config: VectorizeIndexConfig;
  /** A human readable description for the index. */
  readonly description?: string;
  /** The unique ID of the index. */
  readonly id: string;
  /** The name of the index. */
  readonly name: string;
  /** The number of records containing vectors within the index. */
  readonly vectorsCount: number;
}

/**
 * Simplified result type for query operations.
 */
export interface VectorizeQueryResult {
  readonly count: number;
  readonly matches: readonly VectorizeMatch[];
}

/**
 * Simplified result type for mutation operations.
 *
 * Contains the mutation ID (if available from the binding) and optional
 * count/ids from legacy `VectorizeIndex` bindings.
 */
export interface VectorizeMutationResult {
  /** Number of vectors that were mutated (if reported by the binding). */
  readonly count?: number;
  /** IDs of vectors that were mutated (if reported by the binding). */
  readonly ids?: readonly string[];
  /** Mutation ID from the async mutation (new Vectorize class), or "unknown" if not available. */
  readonly mutationId: string;
}

/**
 * Simplified index info type.
 */
export interface VectorizeIndexInfo {
  readonly dimensions: number;
  readonly metric: "cosine" | "euclidean" | "dot-product";
}

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * Vectorize operation failed.
 *
 * Module-specific error wrapping Cloudflare Vectorize exceptions.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new VectorizeError({
 *   operation: "query",
 *   cause: nativeError
 * })
 * ```
 */
export class VectorizeError extends Data.TaggedError("VectorizeError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Service ─────────────────────────────────────────────────────────────

/**
 * Vectorize service for vector similarity search.
 *
 * Provides methods to insert, query, and manage vectors in a Cloudflare Vectorize index.
 * All methods use `Effect.fn` for automatic tracing and return proper Effect types.
 *
 * @example
 * ```ts
 * import { Vectorize } from "effectful-cloudflare/Vectorize"
 * import { Effect } from "effect"
 *
 * const program = Effect.gen(function*() {
 *   const vectorize = yield* Vectorize
 *
 *   // Insert vectors
 *   yield* vectorize.insert([
 *     { id: "doc_1", values: [0.1, 0.2, 0.3] },
 *     { id: "doc_2", values: [0.4, 0.5, 0.6] }
 *   ])
 *
 *   // Query similar vectors
 *   const results = yield* vectorize.query([0.1, 0.2, 0.3], {
 *     topK: 10,
 *     returnMetadata: true
 *   })
 * }).pipe(Effect.provide(Vectorize.layer(env.MY_VECTORIZE_INDEX)))
 * ```
 */
export class Vectorize extends ServiceMap.Service<
  Vectorize,
  {
    readonly insert: (
      vectors: readonly VectorizeVector[]
    ) => Effect.Effect<VectorizeMutationResult, VectorizeError>;
    readonly upsert: (
      vectors: readonly VectorizeVector[]
    ) => Effect.Effect<VectorizeMutationResult, VectorizeError>;
    readonly query: (
      vector: VectorFloatArray | number[],
      options?: VectorizeQueryOptions
    ) => Effect.Effect<VectorizeQueryResult, VectorizeError>;
    readonly getByIds: (
      ids: readonly string[]
    ) => Effect.Effect<readonly VectorizeVector[], VectorizeError>;
    readonly deleteByIds: (
      ids: readonly string[]
    ) => Effect.Effect<VectorizeMutationResult, VectorizeError>;
    readonly describe: () => Effect.Effect<VectorizeIndexInfo, VectorizeError>;
  }
>()("effectful-cloudflare/Vectorize") {
  /**
   * Create a Vectorize service instance from a binding.
   *
   * @param binding - The Vectorize index binding from Cloudflare Workers environment
   * @returns Effect that yields a Vectorize service instance
   *
   * @example
   * ```ts
   * const service = yield* Vectorize.make(env.MY_VECTORIZE_INDEX)
   * ```
   */
  static make = Effect.fn("Vectorize.make")(function* (
    binding: VectorizeBinding
  ) {
    // Helper to wrap Vectorize operations with error handling
    const wrapOperation = <A>(
      operation: string,
      message: string,
      thunk: () => Promise<A>
    ) =>
      Effect.tryPromise({
        try: thunk,
        catch: (cause) => new VectorizeError({ operation, message, cause }),
      });

    const insert = Effect.fn("Vectorize.insert")(function* (
      vectors: readonly VectorizeVector[]
    ) {
      yield* Effect.logDebug("Vectorize.insert").pipe(
        Effect.annotateLogs({ vectorCount: vectors.length })
      );
      const result = yield* wrapOperation(
        "insert",
        "Failed to insert vectors",
        () => binding.insert(vectors)
      );
      return {
        mutationId: result.mutationId ?? "unknown",
        ...(result.count !== undefined && { count: result.count }),
        ...(result.ids !== undefined && { ids: result.ids }),
      };
    });

    const upsert = Effect.fn("Vectorize.upsert")(function* (
      vectors: readonly VectorizeVector[]
    ) {
      yield* Effect.logDebug("Vectorize.upsert").pipe(
        Effect.annotateLogs({ vectorCount: vectors.length })
      );
      const result = yield* wrapOperation(
        "upsert",
        "Failed to upsert vectors",
        () => binding.upsert(vectors)
      );
      return {
        mutationId: result.mutationId ?? "unknown",
        ...(result.count !== undefined && { count: result.count }),
        ...(result.ids !== undefined && { ids: result.ids }),
      };
    });

    const query = Effect.fn("Vectorize.query")(function* (
      vector: VectorFloatArray | number[],
      options?: VectorizeQueryOptions
    ) {
      yield* Effect.logDebug("Vectorize.query").pipe(
        Effect.annotateLogs({
          ...(options?.topK !== undefined && { topK: options.topK }),
        })
      );
      const result = yield* wrapOperation(
        "query",
        "Failed to query vectors",
        () => binding.query(vector, options)
      );
      return {
        matches: result.matches,
        count: result.count,
      };
    });

    const getByIds = Effect.fn("Vectorize.getByIds")(function* (
      ids: readonly string[]
    ) {
      yield* Effect.logDebug("Vectorize.getByIds").pipe(
        Effect.annotateLogs({ idCount: ids.length })
      );
      return yield* wrapOperation(
        "getByIds",
        "Failed to get vectors by IDs",
        () => binding.getByIds(ids)
      );
    });

    const deleteByIds = Effect.fn("Vectorize.deleteByIds")(function* (
      ids: readonly string[]
    ) {
      yield* Effect.logDebug("Vectorize.deleteByIds").pipe(
        Effect.annotateLogs({ idCount: ids.length })
      );
      const result = yield* wrapOperation(
        "deleteByIds",
        "Failed to delete vectors by IDs",
        () => binding.deleteByIds(ids)
      );
      return {
        mutationId: result.mutationId ?? "unknown",
        ...(result.count !== undefined && { count: result.count }),
        ...(result.ids !== undefined && { ids: result.ids }),
      };
    });

    const describe = Effect.fn("Vectorize.describe")(function* () {
      yield* Effect.logDebug("Vectorize.describe");
      const result = yield* wrapOperation(
        "describe",
        "Failed to describe index",
        () => binding.describe()
      );
      return {
        dimensions: result.config.dimensions,
        metric: result.config.metric,
      };
    });

    return Vectorize.of({
      insert,
      upsert,
      query,
      getByIds,
      deleteByIds,
      describe,
    });
  });

  /**
   * Create a Vectorize service layer.
   *
   * @param binding - The Vectorize index binding from Cloudflare Workers environment
   * @returns Layer that provides the Vectorize service
   *
   * @example
   * ```ts
   * const VectorizeLive = Vectorize.layer(env.MY_VECTORIZE_INDEX)
   *
   * const program = Effect.gen(function*() {
   *   const vectorize = yield* Vectorize
   *   // use vectorize...
   * }).pipe(Effect.provide(VectorizeLive))
   * ```
   */
  static layer = (binding: VectorizeBinding) =>
    Layer.effect(this, this.make(binding));
}
