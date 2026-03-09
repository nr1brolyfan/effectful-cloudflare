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
 * Accepts both Cloudflare's legacy `VectorizeIndex` (beta) and the newer
 * `Vectorize` class. The mutation return type is a union that covers both
 * `VectorizeVectorMutation` (`{ ids, count }`) and `VectorizeAsyncMutation`
 * (`{ mutationId }`).
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
 *
 * Re-export of Cloudflare's `VectorFloatArray`.
 */
export type VectorFloatArray = globalThis.VectorFloatArray;

/**
 * Metadata value types supported by Vectorize.
 *
 * Re-export of Cloudflare's `VectorizeVectorMetadataValue`.
 */
export type VectorizeVectorMetadataValue =
  globalThis.VectorizeVectorMetadataValue;

/**
 * Metadata type for Vectorize vectors.
 *
 * Re-export of Cloudflare's `VectorizeVectorMetadata`.
 */
export type VectorizeVectorMetadata = globalThis.VectorizeVectorMetadata;

/**
 * Represents a single vector value set along with its associated metadata.
 *
 * Re-export of Cloudflare's `VectorizeVector`.
 */
export type VectorizeVector = globalThis.VectorizeVector;

/**
 * Represents a matched vector for a query along with its score.
 *
 * Re-export of Cloudflare's `VectorizeMatch`.
 */
export type VectorizeMatch = globalThis.VectorizeMatch;

/**
 * Result of a vector similarity search query.
 *
 * Re-export of Cloudflare's `VectorizeMatches`.
 */
export type VectorizeMatches = globalThis.VectorizeMatches;

/**
 * Index configuration.
 *
 * Cloudflare's `VectorizeIndexConfig` is a discriminated union:
 * - Explicit config: `{ dimensions, metric }` — when the index was created with explicit settings.
 * - Preset config: `{ preset }` — when the index was created using a named preset.
 *
 * Re-export of Cloudflare's `VectorizeIndexConfig`.
 */
export type VectorizeIndexConfig = globalThis.VectorizeIndexConfig;

/**
 * Metadata about an existing index (legacy VectorizeIndex).
 *
 * Re-export of Cloudflare's `VectorizeIndexDetails`.
 */
export type VectorizeIndexDetails = globalThis.VectorizeIndexDetails;

/**
 * Distance metric for vector similarity.
 *
 * Re-export of Cloudflare's `VectorizeDistanceMetric`.
 */
export type VectorizeDistanceMetric = globalThis.VectorizeDistanceMetric;

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
 * Options for vector similarity search.
 *
 * Our subset of Cloudflare's `VectorizeQueryOptions`. We use our own
 * `VectorizeMetadataFilter` for the `filter` field (structurally compatible)
 * and restrict `returnMetadata` to `boolean` for simplicity.
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
 *
 * When the index was created with a named preset, `dimensions` will be `0`
 * and `metric` will default to `"cosine"`. Check for `preset` to detect this case.
 */
export interface VectorizeIndexInfo {
  readonly dimensions: number;
  readonly metric: "cosine" | "euclidean" | "dot-product";
  /** Named preset used when creating the index (only present for preset-based configs). */
  readonly preset?: string | undefined;
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
      // VectorizeIndexConfig is a union: { dimensions, metric } | { preset }.
      // When a preset is used, dimensions/metric are not available.
      const config = result.config;
      if ("dimensions" in config) {
        return {
          dimensions: config.dimensions,
          metric: config.metric,
        };
      }
      return {
        dimensions: 0,
        metric: "cosine" as const,
        preset: config.preset,
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
