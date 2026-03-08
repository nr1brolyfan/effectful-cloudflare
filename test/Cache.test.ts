import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Cache } from "../src/Cache.js";
import { memoryCache } from "../src/Testing.js";

// ── Basic operations ────────────────────────────────────────────────────

it.effect("match returns null for missing entries", () =>
  Effect.gen(function* () {
    const cache = yield* Cache;
    const result = yield* cache.match("https://example.com/missing");
    expect(result).toBe(null);
  }).pipe(Effect.provide(Cache.layer(memoryCache())))
);

it.effect("put then match roundtrip returns the response", () =>
  Effect.gen(function* () {
    const cache = yield* Cache;
    const response = new Response("Hello World", {
      headers: { "Content-Type": "text/plain" },
    });

    yield* cache.put("https://example.com/test", response);

    const cached = yield* cache.match("https://example.com/test");
    expect(cached).not.toBe(null);

    if (cached) {
      const text = yield* Effect.promise(() => cached.text());
      expect(text).toBe("Hello World");
    } else {
      throw new Error("Expected cached to be non-null");
    }
  }).pipe(Effect.provide(Cache.layer(memoryCache())))
);

it.effect("delete removes the cached entry", () =>
  Effect.gen(function* () {
    const cache = yield* Cache;
    const response = new Response("Test");

    yield* cache.put("https://example.com/test", response);
    const deleted = yield* cache.delete("https://example.com/test");
    expect(deleted).toBe(true);

    const result = yield* cache.match("https://example.com/test");
    expect(result).toBe(null);
  }).pipe(Effect.provide(Cache.layer(memoryCache())))
);

it.effect("delete returns false for non-existent entries", () =>
  Effect.gen(function* () {
    const cache = yield* Cache;
    const deleted = yield* cache.delete("https://example.com/missing");
    expect(deleted).toBe(false);
  }).pipe(Effect.provide(Cache.layer(memoryCache())))
);

// ── matchOrFail ─────────────────────────────────────────────────────────

it.effect("matchOrFail returns response when entry exists", () =>
  Effect.gen(function* () {
    const cache = yield* Cache;
    const response = new Response("Success");

    yield* cache.put("https://example.com/exists", response);

    const cached = yield* cache.matchOrFail("https://example.com/exists");
    const text = yield* Effect.promise(() => cached.text());
    expect(text).toBe("Success");
  }).pipe(Effect.provide(Cache.layer(memoryCache())))
);

it.effect("matchOrFail fails with NotFoundError when entry is missing", () =>
  Effect.gen(function* () {
    const cache = yield* Cache;

    const result = yield* Effect.result(
      cache.matchOrFail("https://example.com/missing")
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      const error = result.failure;
      expect(error._tag).toBe("NotFoundError");
      if (error._tag === "NotFoundError") {
        expect(error.resource).toBe("Cache");
        expect(error.key).toBe("https://example.com/missing");
      }
    }
  }).pipe(Effect.provide(Cache.layer(memoryCache())))
);

it.effect("matchOrFail with NotFoundError can be caught with catchTag", () =>
  Effect.gen(function* () {
    const cache = yield* Cache;

    const result = yield* cache.matchOrFail("https://example.com/missing").pipe(
      Effect.catchTag("NotFoundError", (e) =>
        Effect.succeed(`Not found: ${e.key}`)
      ),
      Effect.map((r) => (typeof r === "string" ? r : "Got response instead"))
    );

    expect(result).toBe("Not found: https://example.com/missing");
  }).pipe(Effect.provide(Cache.layer(memoryCache())))
);

// ── JSON mode with schema validation ────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

type User = Schema.Schema.Type<typeof UserSchema>;

it.effect("json mode: put and match with schema validation", () =>
  Effect.gen(function* () {
    const binding = memoryCache();
    const userCache = Cache.json(UserSchema);
    const cache = yield* userCache.make(binding);

    const user: User = {
      id: "123",
      name: "Alice",
      email: "alice@example.com",
    };

    yield* cache.put("https://api.example.com/user/123", user);

    const cached: User | null = yield* cache.match(
      "https://api.example.com/user/123"
    );
    expect(cached).not.toBe(null);
    if (cached) {
      expect(cached.id).toBe("123");
      expect(cached.name).toBe("Alice");
      expect(cached.email).toBe("alice@example.com");
    }
  })
);

it.effect("json mode: match returns null for missing entries", () =>
  Effect.gen(function* () {
    const binding = memoryCache();
    const userCache = Cache.json(UserSchema);
    const cache = yield* userCache.make(binding);

    const result = yield* cache.match("https://api.example.com/user/missing");
    expect(result).toBe(null);
  })
);

it.effect("json mode: matchOrFail returns typed value", () =>
  Effect.gen(function* () {
    const binding = memoryCache();
    const userCache = Cache.json(UserSchema);
    const cache = yield* userCache.make(binding);

    const user: User = {
      id: "456",
      name: "Bob",
      email: "bob@example.com",
    };

    yield* cache.put("https://api.example.com/user/456", user);

    const cached: User = yield* cache.matchOrFail(
      "https://api.example.com/user/456"
    );
    expect(cached.id).toBe("456");
    expect(cached.name).toBe("Bob");
  })
);

it.effect("json mode: matchOrFail fails with NotFoundError when missing", () =>
  Effect.gen(function* () {
    const binding = memoryCache();
    const userCache = Cache.json(UserSchema);
    const cache = yield* userCache.make(binding);

    const result = yield* Effect.result(
      cache.matchOrFail("https://api.example.com/user/missing")
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("NotFoundError");
    }
  })
);

// ── Complex JSON values ─────────────────────────────────────────────────

const PostSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  content: Schema.String,
  tags: Schema.Array(Schema.String),
  metadata: Schema.Struct({
    views: Schema.Number,
    likes: Schema.Number,
  }),
});

type Post = Schema.Schema.Type<typeof PostSchema>;

it.effect("json mode: complex nested objects", () =>
  Effect.gen(function* () {
    const postCache = Cache.json(PostSchema);
    const cache = yield* postCache.make(memoryCache());

    const post: Post = {
      id: "post-1",
      title: "Hello World",
      content: "This is a test post",
      tags: ["test", "example", "cache"],
      metadata: {
        views: 100,
        likes: 42,
      },
    };

    yield* cache.put("https://api.example.com/post/1", post);

    const cached = yield* cache.matchOrFail("https://api.example.com/post/1");
    expect(cached.id).toBe("post-1");
    expect(cached.tags).toEqual(["test", "example", "cache"]);
    expect(cached.metadata.views).toBe(100);
    expect(cached.metadata.likes).toBe(42);
  })
);

// ── Request object support ──────────────────────────────────────────────

it.effect("put and match with Request objects", () =>
  Effect.gen(function* () {
    const cache = yield* Cache;
    const request = new Request("https://example.com/api");
    const response = new Response("API Response");

    yield* cache.put(request, response);

    const cached = yield* cache.match(request);
    expect(cached).not.toBe(null);

    if (cached) {
      const text = yield* Effect.promise(() => cached.text());
      expect(text).toBe("API Response");
    }
  }).pipe(Effect.provide(Cache.layer(memoryCache())))
);

it.effect("match works with both Request and string for same URL", () =>
  Effect.gen(function* () {
    const cache = yield* Cache;
    const url = "https://example.com/test";
    const response = new Response("Cached Data");

    // Put with string
    yield* cache.put(url, response);

    // Match with Request object (should match by URL)
    const request = new Request(url);
    const cached = yield* cache.match(request);
    expect(cached).not.toBe(null);

    if (cached) {
      const text = yield* Effect.promise(() => cached.text());
      expect(text).toBe("Cached Data");
    }
  }).pipe(Effect.provide(Cache.layer(memoryCache())))
);

// ── Error handling ──────────────────────────────────────────────────────

it.effect("CacheError is catchable with catchTag", () =>
  Effect.gen(function* () {
    // Since our mock doesn't throw, we'll simulate an error scenario
    // by providing a binding that throws
    const errorBinding = {
      match: () => Promise.reject(new Error("Network error")),
      put: () => Promise.reject(new Error("Network error")),
      delete: () => Promise.reject(new Error("Network error")),
    };

    const errorCache = yield* Cache.make(errorBinding);

    const result = yield* errorCache
      .match("https://example.com/test")
      .pipe(
        Effect.catchTag("CacheError", (e) =>
          Effect.succeed(`Caught: ${e.operation}`)
        )
      );

    expect(result).toBe("Caught: match");
  })
);
