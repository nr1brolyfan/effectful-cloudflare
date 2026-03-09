import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { memoryVectorize } from "../src/Testing.js";
import { Vectorize } from "../src/Vectorize.js";

// ── Basic operations ────────────────────────────────────────────────────

it.effect("insert adds vectors to the index", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    const result = yield* vectorize.insert([
      { id: "doc_1", values: [0.1, 0.2, 0.3] },
      { id: "doc_2", values: [0.4, 0.5, 0.6] },
    ]);

    expect(result.mutationId).toBeDefined();
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("insert fails when vector ID already exists", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([{ id: "doc_1", values: [0.1, 0.2, 0.3] }]);

    const result = yield* Effect.exit(
      vectorize.insert([{ id: "doc_1", values: [0.4, 0.5, 0.6] }])
    );

    expect(result._tag).toBe("Failure");
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("upsert inserts new vectors", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    const result = yield* vectorize.upsert([
      { id: "doc_1", values: [0.1, 0.2, 0.3] },
    ]);

    expect(result.mutationId).toBeDefined();

    const vectors = yield* vectorize.getByIds(["doc_1"]);
    expect(vectors).toHaveLength(1);
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("upsert updates existing vectors", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([{ id: "doc_1", values: [0.1, 0.2, 0.3] }]);

    yield* vectorize.upsert([{ id: "doc_1", values: [0.7, 0.8, 0.9] }]);

    const vectors = yield* vectorize.getByIds(["doc_1"]);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]?.values).toEqual([0.7, 0.8, 0.9]);
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

// ── Query operations ────────────────────────────────────────────────────

it.effect("query returns similar vectors", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([
      { id: "doc_1", values: [0.1, 0.2, 0.3] },
      { id: "doc_2", values: [0.4, 0.5, 0.6] },
      { id: "doc_3", values: [0.7, 0.8, 0.9] },
    ]);

    const result = yield* vectorize.query([0.1, 0.2, 0.3], { topK: 2 });

    expect(result.matches).toHaveLength(2);
    expect(result.count).toBe(2);
    // The most similar vector should be doc_1
    expect(result.matches[0]?.id).toBe("doc_1");
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("query respects topK parameter", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([
      { id: "doc_1", values: [0.1, 0.2, 0.3] },
      { id: "doc_2", values: [0.4, 0.5, 0.6] },
      { id: "doc_3", values: [0.7, 0.8, 0.9] },
      { id: "doc_4", values: [1.0, 1.1, 1.2] },
    ]);

    const result = yield* vectorize.query([0.1, 0.2, 0.3], { topK: 3 });

    expect(result.matches).toHaveLength(3);
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("query returns metadata when requested", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([
      {
        id: "doc_1",
        values: [0.1, 0.2, 0.3],
        metadata: { title: "Document 1", tags: ["tag1", "tag2"] },
      },
    ]);

    const result = yield* vectorize.query([0.1, 0.2, 0.3], {
      topK: 1,
      returnMetadata: true,
    });

    expect(result.matches[0]?.metadata).toBeDefined();
    expect(result.matches[0]?.metadata?.title).toBe("Document 1");
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("query returns values when requested", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([{ id: "doc_1", values: [0.1, 0.2, 0.3] }]);

    const result = yield* vectorize.query([0.1, 0.2, 0.3], {
      topK: 1,
      returnValues: true,
    });

    expect(result.matches[0]?.values).toBeDefined();
    expect(result.matches[0]?.values).toEqual([0.1, 0.2, 0.3]);
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("query filters by namespace", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([
      { id: "doc_1", values: [0.1, 0.2, 0.3], namespace: "ns1" },
      { id: "doc_2", values: [0.4, 0.5, 0.6], namespace: "ns2" },
      { id: "doc_3", values: [0.7, 0.8, 0.9], namespace: "ns1" },
    ]);

    const result = yield* vectorize.query([0.1, 0.2, 0.3], {
      topK: 5,
      namespace: "ns1",
    });

    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((m) => m.namespace === "ns1")).toBe(true);
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("query filters by metadata", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([
      {
        id: "doc_1",
        values: [0.1, 0.2, 0.3],
        metadata: { category: "tech", published: true },
      },
      {
        id: "doc_2",
        values: [0.4, 0.5, 0.6],
        metadata: { category: "news", published: true },
      },
      {
        id: "doc_3",
        values: [0.7, 0.8, 0.9],
        metadata: { category: "tech", published: false },
      },
    ]);

    const result = yield* vectorize.query([0.1, 0.2, 0.3], {
      topK: 5,
      filter: { category: "tech", published: true },
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.id).toBe("doc_1");
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

// ── getByIds operations ─────────────────────────────────────────────────

it.effect("getByIds returns vectors by ID", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([
      { id: "doc_1", values: [0.1, 0.2, 0.3] },
      { id: "doc_2", values: [0.4, 0.5, 0.6] },
      { id: "doc_3", values: [0.7, 0.8, 0.9] },
    ]);

    const vectors = yield* vectorize.getByIds(["doc_1", "doc_3"]);

    expect(vectors).toHaveLength(2);
    expect(vectors.map((v) => v.id)).toContain("doc_1");
    expect(vectors.map((v) => v.id)).toContain("doc_3");
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("getByIds returns empty array for non-existent IDs", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    const vectors = yield* vectorize.getByIds(["nonexistent"]);

    expect(vectors).toHaveLength(0);
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

// ── deleteByIds operations ──────────────────────────────────────────────

it.effect("deleteByIds removes vectors", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([
      { id: "doc_1", values: [0.1, 0.2, 0.3] },
      { id: "doc_2", values: [0.4, 0.5, 0.6] },
    ]);

    const result = yield* vectorize.deleteByIds(["doc_1"]);

    expect(result.mutationId).toBeDefined();

    const vectors = yield* vectorize.getByIds(["doc_1"]);
    expect(vectors).toHaveLength(0);
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("deleteByIds handles non-existent IDs gracefully", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    const result = yield* vectorize.deleteByIds(["nonexistent"]);

    expect(result.mutationId).toBeDefined();
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

// ── describe operation ──────────────────────────────────────────────────

it.effect("describe returns index info", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([
      { id: "doc_1", values: [0.1, 0.2, 0.3] },
      { id: "doc_2", values: [0.4, 0.5, 0.6] },
    ]);

    const info = yield* vectorize.describe();

    expect(info.dimensions).toBe(3);
    expect(info.metric).toBe("cosine");
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("describe works with custom dimensions", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    const info = yield* vectorize.describe();

    expect(info.dimensions).toBe(128);
    expect(info.metric).toBe("euclidean");
  }).pipe(
    Effect.provide(
      Vectorize.layer(memoryVectorize({ dimensions: 128, metric: "euclidean" }))
    )
  )
);

// ── Error handling ──────────────────────────────────────────────────────

it.effect("wraps binding errors in VectorizeError", () =>
  Effect.gen(function* () {
    // Create a mock binding that throws
    const failingBinding = {
      insert: () => Promise.reject(new Error("Binding failed")),
      upsert: () => Promise.reject(new Error("Binding failed")),
      query: () => Promise.reject(new Error("Binding failed")),
      getByIds: () => Promise.reject(new Error("Binding failed")),
      deleteByIds: () => Promise.reject(new Error("Binding failed")),
      describe: () => Promise.reject(new Error("Binding failed")),
    };

    const error = yield* Effect.gen(function* () {
      const vectorize = yield* Vectorize;
      yield* vectorize.query([0.1, 0.2, 0.3]);
    })
      .pipe(Effect.provide(Vectorize.layer(failingBinding)))
      .pipe(Effect.flip);

    expect(error._tag).toBe("VectorizeError");
    expect(error.operation).toBe("query");
  })
);

// ── Error handling for each operation ────────────────────────────────────

it.effect("VectorizeError on insert binding failure", () => {
  const binding: any = {
    insert: () => Promise.reject(new Error("Insert failed")),
    upsert: () => Promise.reject(new Error("Upsert failed")),
    query: () => Promise.reject(new Error("Query failed")),
    getByIds: () => Promise.reject(new Error("GetByIds failed")),
    deleteByIds: () => Promise.reject(new Error("DeleteByIds failed")),
    describe: () => Promise.reject(new Error("Describe failed")),
  };

  return Effect.gen(function* () {
    const vectorize = yield* Vectorize;
    const error = yield* vectorize
      .insert([{ id: "doc_1", values: [0.1, 0.2, 0.3] }])
      .pipe(Effect.flip);
    expect(error._tag).toBe("VectorizeError");
    if (error._tag === "VectorizeError") {
      expect(error.operation).toBe("insert");
    }
  }).pipe(Effect.provide(Vectorize.layer(binding)));
});

it.effect("VectorizeError on upsert binding failure", () => {
  const binding: any = {
    insert: () => Promise.reject(new Error("Insert failed")),
    upsert: () => Promise.reject(new Error("Upsert failed")),
    query: () => Promise.reject(new Error("Query failed")),
    getByIds: () => Promise.reject(new Error("GetByIds failed")),
    deleteByIds: () => Promise.reject(new Error("DeleteByIds failed")),
    describe: () => Promise.reject(new Error("Describe failed")),
  };

  return Effect.gen(function* () {
    const vectorize = yield* Vectorize;
    const error = yield* vectorize
      .upsert([{ id: "doc_1", values: [0.1, 0.2, 0.3] }])
      .pipe(Effect.flip);
    expect(error._tag).toBe("VectorizeError");
    if (error._tag === "VectorizeError") {
      expect(error.operation).toBe("upsert");
    }
  }).pipe(Effect.provide(Vectorize.layer(binding)));
});

it.effect("VectorizeError on getByIds binding failure", () => {
  const binding: any = {
    insert: () => Promise.reject(new Error("Insert failed")),
    upsert: () => Promise.reject(new Error("Upsert failed")),
    query: () => Promise.reject(new Error("Query failed")),
    getByIds: () => Promise.reject(new Error("GetByIds failed")),
    deleteByIds: () => Promise.reject(new Error("DeleteByIds failed")),
    describe: () => Promise.reject(new Error("Describe failed")),
  };

  return Effect.gen(function* () {
    const vectorize = yield* Vectorize;
    const error = yield* vectorize.getByIds(["doc_1"]).pipe(Effect.flip);
    expect(error._tag).toBe("VectorizeError");
    if (error._tag === "VectorizeError") {
      expect(error.operation).toBe("getByIds");
    }
  }).pipe(Effect.provide(Vectorize.layer(binding)));
});

it.effect("VectorizeError on deleteByIds binding failure", () => {
  const binding: any = {
    insert: () => Promise.reject(new Error("Insert failed")),
    upsert: () => Promise.reject(new Error("Upsert failed")),
    query: () => Promise.reject(new Error("Query failed")),
    getByIds: () => Promise.reject(new Error("GetByIds failed")),
    deleteByIds: () => Promise.reject(new Error("DeleteByIds failed")),
    describe: () => Promise.reject(new Error("Describe failed")),
  };

  return Effect.gen(function* () {
    const vectorize = yield* Vectorize;
    const error = yield* vectorize.deleteByIds(["doc_1"]).pipe(Effect.flip);
    expect(error._tag).toBe("VectorizeError");
    if (error._tag === "VectorizeError") {
      expect(error.operation).toBe("deleteByIds");
    }
  }).pipe(Effect.provide(Vectorize.layer(binding)));
});

it.effect("VectorizeError on describe binding failure", () => {
  const binding: any = {
    insert: () => Promise.reject(new Error("Insert failed")),
    upsert: () => Promise.reject(new Error("Upsert failed")),
    query: () => Promise.reject(new Error("Query failed")),
    getByIds: () => Promise.reject(new Error("GetByIds failed")),
    deleteByIds: () => Promise.reject(new Error("DeleteByIds failed")),
    describe: () => Promise.reject(new Error("Describe failed")),
  };

  return Effect.gen(function* () {
    const vectorize = yield* Vectorize;
    const error = yield* vectorize.describe().pipe(Effect.flip);
    expect(error._tag).toBe("VectorizeError");
    if (error._tag === "VectorizeError") {
      expect(error.operation).toBe("describe");
    }
  }).pipe(Effect.provide(Vectorize.layer(binding)));
});

it.effect("VectorizeError can be caught with catchTag", () => {
  const binding: any = {
    insert: () => Promise.reject(new Error("Insert failed")),
    upsert: () => Promise.reject(new Error("Upsert failed")),
    query: () => Promise.reject(new Error("Query failed")),
    getByIds: () => Promise.reject(new Error("GetByIds failed")),
    deleteByIds: () => Promise.reject(new Error("DeleteByIds failed")),
    describe: () => Promise.reject(new Error("Describe failed")),
  };

  return Effect.gen(function* () {
    const vectorize = yield* Vectorize;
    const result = yield* vectorize
      .insert([{ id: "doc_1", values: [0.1, 0.2, 0.3] }])
      .pipe(
        Effect.catchTag("VectorizeError", (error) =>
          Effect.succeed(`Caught: ${error.operation}`)
        )
      );
    expect(result).toBe("Caught: insert");
  }).pipe(Effect.provide(Vectorize.layer(binding)));
});

// ── Edge cases ──────────────────────────────────────────────────────────

it.effect("query returns empty matches when no vectors", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;
    const result = yield* vectorize.query([0.1, 0.2, 0.3], { topK: 5 });
    expect(result.matches).toHaveLength(0);
    expect(result.count).toBe(0);
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("getByIds returns empty for non-existent IDs", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;
    const result = yield* vectorize.getByIds(["non-existent"]);
    expect(result).toHaveLength(0);
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("deleteByIds with non-existent IDs returns zero count", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;
    const result = yield* vectorize.deleteByIds(["non-existent"]);
    expect(result.mutationId).toBeDefined();
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);

it.effect("insert then deleteByIds removes vectors", () =>
  Effect.gen(function* () {
    const vectorize = yield* Vectorize;

    yield* vectorize.insert([
      { id: "doc_1", values: [0.1, 0.2, 0.3] },
      { id: "doc_2", values: [0.4, 0.5, 0.6] },
    ]);

    yield* vectorize.deleteByIds(["doc_1"]);

    const remaining = yield* vectorize.getByIds(["doc_1", "doc_2"]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("doc_2");
  }).pipe(Effect.provide(Vectorize.layer(memoryVectorize())))
);
