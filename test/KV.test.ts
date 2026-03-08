import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { KV } from "../src/KV.js";
import { memoryKV } from "../src/Testing.js";

// ── Basic operations ────────────────────────────────────────────────────

it.effect("get returns null for missing keys", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const result = yield* kv.get("nonexistent");
    expect(result).toBe(null);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("put then get roundtrip returns the value", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("key", "value");
    const result = yield* kv.get("key");
    expect(result).toBe("value");
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("delete removes the key", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("key", "value");
    yield* kv.delete("key");
    const result = yield* kv.get("key");
    expect(result).toBe(null);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

// ── JSON values ─────────────────────────────────────────────────────────

it.effect("put and get with objects (automatic JSON serialization)", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const data = { name: "Alice", age: 30 };
    yield* kv.put("key", data);
    const result = yield* kv.get("key");
    expect(result).toEqual(data);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("put and get with arrays", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const data = [1, 2, 3];
    yield* kv.put("key", data);
    const result = yield* kv.get("key");
    expect(result).toEqual(data);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("put and get with numbers", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("key", 42);
    const result = yield* kv.get("key");
    expect(result).toBe(42);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("put and get with booleans", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("key", true);
    const result = yield* kv.get("key");
    expect(result).toBe(true);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

// ── List operations ─────────────────────────────────────────────────────

it.effect("list returns all keys", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("a", "1");
    yield* kv.put("b", "2");
    yield* kv.put("c", "3");

    const result = yield* kv.list();
    expect(result.list_complete).toBe(true);
    expect(result.keys.length).toBe(3);
    expect(result.keys.map((k) => k.name)).toEqual(["a", "b", "c"]);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("list with prefix filtering", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("user:1", "alice");
    yield* kv.put("user:2", "bob");
    yield* kv.put("post:1", "hello");

    const result = yield* kv.list({ prefix: "user:" });
    expect(result.list_complete).toBe(true);
    expect(result.keys.length).toBe(2);
    expect(result.keys.map((k) => k.name)).toEqual(["user:1", "user:2"]);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("list pagination with limit and cursor", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("a", "1");
    yield* kv.put("b", "2");
    yield* kv.put("c", "3");
    yield* kv.put("d", "4");

    // First page
    const page1 = yield* kv.list({ limit: 2 });
    expect(page1.list_complete).toBe(false);
    expect(page1.keys.length).toBe(2);
    expect(page1.keys.map((k) => k.name)).toEqual(["a", "b"]);
    expect(page1.cursor).toBeDefined();

    // Second page
    const page2 = yield* kv.list({
      limit: 2,
      ...(page1.cursor && { cursor: page1.cursor }),
    });
    expect(page2.list_complete).toBe(true);
    expect(page2.keys.length).toBe(2);
    expect(page2.keys.map((k) => k.name)).toEqual(["c", "d"]);
    expect(page2.cursor).toBeUndefined();
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

// ── Metadata ────────────────────────────────────────────────────────────

it.effect("getWithMetadata returns value and metadata", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const metadata = { author: "alice", version: 1 };
    yield* kv.put("key", "value", { metadata });

    const result = yield* kv.getWithMetadata<typeof metadata>("key");
    expect(result.value).toBe("value");
    expect(result.metadata).toEqual(metadata);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("getWithMetadata returns null metadata for keys without it", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("key", "value");

    const result = yield* kv.getWithMetadata("key");
    expect(result.value).toBe("value");
    expect(result.metadata).toBe(null);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

// ── Expiration ──────────────────────────────────────────────────────────

it.effect("put with expirationTtl - key expires after TTL", () =>
  Effect.gen(function* () {
    const kv = yield* KV;

    // Put with TTL of -1 seconds (already expired)
    yield* kv.put("key", "value", { expirationTtl: -1 });

    // Key should be expired immediately
    const result = yield* kv.get("key");
    expect(result).toBe(null);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("put with absolute expiration - key expires at timestamp", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Put with absolute expiration in the past
    yield* kv.put("key", "value", { expiration: nowSeconds - 10 });

    // Key should be expired
    const result = yield* kv.get("key");
    expect(result).toBe(null);
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("list filters out expired keys", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("active", "value1");
    yield* kv.put("expired", "value2", { expirationTtl: -1 });

    const result = yield* kv.list();
    expect(result.keys.length).toBe(1);
    expect(result.keys[0]?.name).toBe("active");
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

// ── Multiple operations in one test ─────────────────────────────────────

it.effect("complex workflow - multiple operations", () =>
  Effect.gen(function* () {
    const kv = yield* KV;

    // Store multiple values
    yield* kv.put("user:1", "alice", { metadata: { role: "admin" } });
    yield* kv.put("user:2", "bob", { metadata: { role: "user" } });
    yield* kv.put("post:1", "hello world");

    // List users
    const users = yield* kv.list({ prefix: "user:" });
    expect(users.keys.length).toBe(2);

    // Get with metadata
    const user1 = yield* kv.getWithMetadata<{ role: string }>("user:1");
    expect(user1.value).toBe("alice");
    expect(user1.metadata?.role).toBe("admin");

    // Delete a user
    yield* kv.delete("user:2");

    // Verify deletion
    const afterDelete = yield* kv.list({ prefix: "user:" });
    expect(afterDelete.keys.length).toBe(1);
    expect(afterDelete.keys[0]?.name).toBe("user:1");
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

// ── getOrFail and error handling ────────────────────────────────────────

it.effect("getOrFail returns value when key exists", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("key", "value");

    const result = yield* kv.getOrFail("key");
    expect(result).toBe("value");
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("getOrFail fails with NotFoundError when key is missing", () =>
  Effect.gen(function* () {
    const kv = yield* KV;

    const result = yield* kv.getOrFail("nonexistent").pipe(Effect.flip);

    // Verify it's a NotFoundError
    if (result._tag === "NotFoundError") {
      expect(result._tag).toBe("NotFoundError");
      expect(result.resource).toBe("KV");
      expect(result.key).toBe("nonexistent");
    } else {
      throw new Error("Expected NotFoundError");
    }
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("getOrFail can be caught with catchTag", () =>
  Effect.gen(function* () {
    const kv = yield* KV;

    const result = yield* kv
      .getOrFail("nonexistent")
      .pipe(
        Effect.catchTag("NotFoundError", (error) =>
          Effect.succeed(`Not found: ${error.key}`)
        )
      );

    expect(result).toBe("Not found: nonexistent");
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

it.effect("getOrFail fails on expired keys", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    yield* kv.put("key", "value", { expirationTtl: -1 });

    const result = yield* kv.getOrFail("key").pipe(Effect.flip);

    expect(result._tag).toBe("NotFoundError");
  }).pipe(Effect.provide(KV.layer(memoryKV())))
);

// ── Schema validation mode ──────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});
type User = typeof UserSchema.Type;

it.effect("schema mode - put and get with schema validation", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const user: User = {
      id: "123",
      name: "Alice",
      email: "alice@example.com",
    };

    yield* kv.put("user:123", user);
    const result = yield* kv.get("user:123");

    expect(result).toEqual(user);
  }).pipe(Effect.provide(KV.layer(memoryKV(), UserSchema)))
);

it.effect("schema mode - get returns null for missing keys", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const result = yield* kv.get("nonexistent");
    expect(result).toBe(null);
  }).pipe(Effect.provide(KV.layer(memoryKV(), UserSchema)))
);

it.effect("schema mode - getOrFail returns typed value", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const user: User = {
      id: "456",
      name: "Bob",
      email: "bob@example.com",
    };

    yield* kv.put("user:456", user);
    const result = yield* kv.getOrFail("user:456");

    expect(result).toEqual(user);
  }).pipe(Effect.provide(KV.layer(memoryKV(), UserSchema)))
);

it.effect(
  "schema mode - getOrFail fails with NotFoundError for missing keys",
  () =>
    Effect.gen(function* () {
      const kv = yield* KV;

      const result = yield* kv.getOrFail("nonexistent").pipe(Effect.flip);

      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(KV.layer(memoryKV(), UserSchema)))
);

it.effect(
  "schema mode - getWithMetadata returns typed value with metadata",
  () =>
    Effect.gen(function* () {
      const kv = yield* KV;
      const user: User = {
        id: "789",
        name: "Charlie",
        email: "charlie@example.com",
      };
      const metadata = { version: 1, author: "admin" };

      yield* kv.put("user:789", user, { metadata });
      const result = yield* kv.getWithMetadata("user:789");

      expect(result.value).toEqual(user);
      expect(result.metadata).toEqual(metadata);
    }).pipe(Effect.provide(KV.layer(memoryKV(), UserSchema)))
);

it.effect("schema mode - handles multiple users", () =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const users: User[] = [
      { id: "1", name: "Alice", email: "alice@example.com" },
      { id: "2", name: "Bob", email: "bob@example.com" },
      { id: "3", name: "Charlie", email: "charlie@example.com" },
    ];

    // Store all users
    for (const user of users) {
      yield* kv.put(`user:${user.id}`, user);
    }

    // Retrieve and verify
    const alice = yield* kv.getOrFail("user:1");
    const bob = yield* kv.getOrFail("user:2");
    const charlie = yield* kv.getOrFail("user:3");

    expect(alice).toEqual(users[0]);
    expect(bob).toEqual(users[1]);
    expect(charlie).toEqual(users[2]);

    // List all users
    const list = yield* kv.list({ prefix: "user:" });
    expect(list.keys.length).toBe(3);
  }).pipe(Effect.provide(KV.layer(memoryKV(), UserSchema)))
);
