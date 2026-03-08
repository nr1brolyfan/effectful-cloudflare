import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { R2 } from "../src/R2.js";
import { memoryR2 } from "../src/Testing.js";

// ── Basic get/put operations ────────────────────────────────────────────

it.effect("put and get roundtrip returns the object", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    yield* r2.put("test-file.txt", "Hello, R2!");
    const obj = yield* r2.get("test-file.txt");

    expect(obj).not.toBeNull();
    if (!obj) {
      return;
    }

    const text = yield* Effect.promise(() => obj.text());
    expect(text).toBe("Hello, R2!");
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

it.effect("get returns null for non-existent keys", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    const obj = yield* r2.get("non-existent-file.txt");

    expect(obj).toBeNull();
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

it.effect("put with ArrayBuffer", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    const data = new TextEncoder().encode("Binary data");
    yield* r2.put("binary-file.bin", data.buffer);

    const obj = yield* r2.get("binary-file.bin");
    expect(obj).not.toBeNull();
    if (!obj) {
      return;
    }

    const retrieved = yield* Effect.promise(() => obj.arrayBuffer());
    const text = new TextDecoder().decode(retrieved);
    expect(text).toBe("Binary data");
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

it.effect("put with metadata", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    const httpMetadata = {
      contentType: "text/plain",
      cacheControl: "max-age=3600",
    };
    const customMetadata = {
      author: "alice",
      version: "1.0",
    };

    yield* r2.put("file-with-metadata.txt", "Content", {
      httpMetadata,
      customMetadata,
    });

    const obj = yield* r2.get("file-with-metadata.txt");
    expect(obj).not.toBeNull();
    if (!obj) {
      return;
    }
    expect(obj.httpMetadata?.contentType).toBe("text/plain");
    expect(obj.customMetadata?.author).toBe("alice");
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

// ── Delete operations ───────────────────────────────────────────────────

it.effect("delete removes object", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    yield* r2.put("temp-file.txt", "Temporary");
    yield* r2.delete("temp-file.txt");

    const obj = yield* r2.get("temp-file.txt");
    expect(obj).toBeNull();
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

it.effect("delete with array of keys", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    yield* r2.put("file1.txt", "Content 1");
    yield* r2.put("file2.txt", "Content 2");
    yield* r2.put("file3.txt", "Content 3");

    yield* r2.delete(["file1.txt", "file2.txt"]);

    const obj1 = yield* r2.get("file1.txt");
    const obj2 = yield* r2.get("file2.txt");
    const obj3 = yield* r2.get("file3.txt");

    expect(obj1).toBeNull();
    expect(obj2).toBeNull();
    expect(obj3).not.toBeNull();
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

// ── Head operations ─────────────────────────────────────────────────────

it.effect("head returns metadata without body", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    yield* r2.put("metadata-test.txt", "Some content", {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { key: "value" },
    });

    const info = yield* r2.head("metadata-test.txt");

    expect(info).not.toBeNull();
    if (!info) {
      return;
    }
    expect(info.key).toBe("metadata-test.txt");
    expect(info.httpMetadata?.contentType).toBe("text/plain");
    expect(info.customMetadata?.key).toBe("value");
    expect(info.size).toBeGreaterThan(0);
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

it.effect("head returns null for non-existent keys", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    const info = yield* r2.head("non-existent.txt");

    expect(info).toBeNull();
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

// ── List operations ─────────────────────────────────────────────────────

it.effect("list returns all objects", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    yield* r2.put("file-a.txt", "A");
    yield* r2.put("file-b.txt", "B");
    yield* r2.put("file-c.txt", "C");

    const result = yield* r2.list();

    expect(result.objects.length).toBe(3);
    expect(result.truncated).toBe(false);
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

it.effect("list with prefix filtering", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    yield* r2.put("users/alice.json", "{}");
    yield* r2.put("users/bob.json", "{}");
    yield* r2.put("posts/post1.md", "# Post");

    const result = yield* r2.list({ prefix: "users/" });

    expect(result.objects.length).toBe(2);
    expect(result.objects[0]?.key).toContain("users/");
    expect(result.objects[1]?.key).toContain("users/");
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

it.effect("list pagination with limit and cursor", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    yield* r2.put("file-a.txt", "A");
    yield* r2.put("file-b.txt", "B");
    yield* r2.put("file-c.txt", "C");
    yield* r2.put("file-d.txt", "D");

    // First page
    const page1 = yield* r2.list({ limit: 2 });
    expect(page1.objects.length).toBe(2);
    expect(page1.truncated).toBe(true);
    expect(page1.cursor).toBeDefined();

    // Second page
    const page2 = yield* r2.list({
      limit: 2,
      ...(page1.cursor && { cursor: page1.cursor }),
    });
    expect(page2.objects.length).toBe(2);
    expect(page2.truncated).toBe(false);
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

// ── getOrFail operations ────────────────────────────────────────────────

it.effect("getOrFail returns object when found", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    yield* r2.put("existing-file.txt", "Exists");

    const obj = yield* r2.getOrFail("existing-file.txt");

    const text = yield* Effect.promise(() => obj.text());
    expect(text).toBe("Exists");
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

it.effect("getOrFail fails with NotFoundError when object missing", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    const result = yield* r2.getOrFail("non-existent.txt").pipe(Effect.flip);

    expect(result._tag).toBe("NotFoundError");
    if (result._tag === "NotFoundError") {
      expect(result.resource).toBe("R2");
      expect(result.key).toBe("non-existent.txt");
    }
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

it.effect("getOrFail can be caught with catchTag", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    const result = yield* r2.getOrFail("missing.txt").pipe(
      Effect.catchTag(
        "NotFoundError",
        (error) =>
          Effect.succeed({
            key: error.key,
            body: new ReadableStream(),
            text: () => Promise.resolve("Fallback content"),
          } as any) // Type assertion for test purposes
      )
    );

    const text = yield* Effect.promise(() => result.text());
    expect(text).toBe("Fallback content");
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

// ── Multipart upload operations ─────────────────────────────────────────

it.effect("createMultipartUpload and complete upload", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    const upload = yield* r2.createMultipartUpload("large-file.bin");

    // Upload parts
    const part1 = yield* Effect.promise(() =>
      upload.uploadPart(1, "Part 1 data")
    );
    const part2 = yield* Effect.promise(() =>
      upload.uploadPart(2, "Part 2 data")
    );

    // Complete upload
    const result = yield* Effect.promise(() => upload.complete([part1, part2]));

    expect(result.key).toBe("large-file.bin");

    // Verify the object exists and has combined content
    const obj = yield* r2.get("large-file.bin");
    expect(obj).not.toBeNull();
    if (!obj) {
      return;
    }

    const text = yield* Effect.promise(() => obj.text());
    expect(text).toBe("Part 1 dataPart 2 data");
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

it.effect("multipart upload abort", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    const upload = yield* r2.createMultipartUpload("aborted-file.bin");

    // Upload a part
    yield* Effect.promise(() => upload.uploadPart(1, "Part 1 data"));

    // Abort the upload
    yield* Effect.promise(() => upload.abort());

    // Verify the object was not created
    const obj = yield* r2.get("aborted-file.bin");
    expect(obj).toBeNull();
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

// ── Complex workflow ────────────────────────────────────────────────────

it.effect("complex workflow - upload, list, retrieve, delete", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;

    // Upload multiple files
    yield* r2.put("documents/doc1.txt", "Document 1", {
      customMetadata: { author: "alice" },
    });
    yield* r2.put("documents/doc2.txt", "Document 2", {
      customMetadata: { author: "bob" },
    });
    yield* r2.put("images/photo.jpg", "Binary image data");

    // List all documents
    const docs = yield* r2.list({ prefix: "documents/" });
    expect(docs.objects.length).toBe(2);

    // Get metadata for one document
    const doc1Info = yield* r2.head("documents/doc1.txt");
    expect(doc1Info?.customMetadata?.author).toBe("alice");

    // Retrieve and verify content
    const doc1 = yield* r2.getOrFail("documents/doc1.txt");
    const text = yield* Effect.promise(() => doc1.text());
    expect(text).toBe("Document 1");

    // Delete all documents
    yield* r2.delete(["documents/doc1.txt", "documents/doc2.txt"]);

    // Verify documents are deleted but image remains
    const afterDelete = yield* r2.list();
    expect(afterDelete.objects.length).toBe(1);
    expect(afterDelete.objects[0]?.key).toBe("images/photo.jpg");
  }).pipe(Effect.provide(R2.layer(memoryR2())))
);

// ── JSON mode with schema validation ────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  age: Schema.Number,
});
type User = typeof UserSchema.Type;

it.effect(
  "JSON mode - put and get with schema validation",
  () =>
    Effect.gen(function* () {
      const r2 = (yield* R2) as any; // Type assertion for JSON mode
      const user: User = {
        id: "123",
        name: "Alice",
        email: "alice@example.com",
        age: 30,
      };

      yield* r2.put("users/alice.json", user);
      const retrieved: User | null = yield* r2.get("users/alice.json");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe("Alice");
      expect(retrieved?.email).toBe("alice@example.com");
      expect(retrieved?.age).toBe(30);
    }).pipe(
      Effect.provide(R2.json(UserSchema).layer(memoryR2()))
    ) as Effect.Effect<void>
);

it.effect("JSON mode - get returns null for missing keys", () =>
  Effect.gen(function* () {
    const r2 = yield* R2;
    const result = yield* r2.get("non-existent.json");
    expect(result).toBeNull();
  }).pipe(Effect.provide(R2.json(UserSchema).layer(memoryR2())))
);

it.effect(
  "JSON mode - getOrFail returns typed value",
  () =>
    Effect.gen(function* () {
      const r2 = (yield* R2) as any; // Type assertion for JSON mode
      const user: User = {
        id: "456",
        name: "Bob",
        email: "bob@example.com",
        age: 25,
      };

      yield* r2.put("users/bob.json", user);
      const retrieved: User = yield* r2.getOrFail("users/bob.json");

      expect(retrieved.name).toBe("Bob");
      expect(retrieved.age).toBe(25);
    }).pipe(
      Effect.provide(R2.json(UserSchema).layer(memoryR2()))
    ) as Effect.Effect<void>
);

it.effect(
  "JSON mode - getOrFail fails with NotFoundError for missing keys",
  () =>
    Effect.gen(function* () {
      const r2 = yield* R2;

      const result = yield* r2.getOrFail("non-existent.json").pipe(Effect.flip);

      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(R2.json(UserSchema).layer(memoryR2())))
);

it.effect(
  "JSON mode - handles multiple objects",
  () =>
    Effect.gen(function* () {
      const r2 = (yield* R2) as any; // Type assertion for JSON mode
      const users: User[] = [
        { id: "1", name: "Alice", email: "alice@example.com", age: 30 },
        { id: "2", name: "Bob", email: "bob@example.com", age: 25 },
        { id: "3", name: "Charlie", email: "charlie@example.com", age: 35 },
      ];

      // Store all users
      for (const user of users) {
        yield* r2.put(`users/${user.id}.json`, user);
      }

      // Retrieve and verify
      const alice: User = yield* r2.getOrFail("users/1.json");
      const bob: User = yield* r2.getOrFail("users/2.json");
      const charlie: User = yield* r2.getOrFail("users/3.json");

      expect(alice.name).toBe("Alice");
      expect(bob.name).toBe("Bob");
      expect(charlie.name).toBe("Charlie");

      // List all users
      const list = yield* r2.list({ prefix: "users/" });
      expect(list.objects.length).toBe(3);
    }).pipe(
      Effect.provide(R2.json(UserSchema).layer(memoryR2()))
    ) as Effect.Effect<void>
);

it.effect(
  "JSON mode - put with custom metadata",
  () =>
    Effect.gen(function* () {
      const r2 = (yield* R2) as any; // Type assertion for JSON mode
      const user: User = {
        id: "789",
        name: "Diana",
        email: "diana@example.com",
        age: 28,
      };
      const metadata = { version: "1", author: "admin" };

      yield* r2.put("users/diana.json", user, {
        customMetadata: metadata,
        httpMetadata: { contentType: "application/json" },
      });

      // Verify metadata via head operation
      const info = yield* r2.head("users/diana.json");
      expect(info).not.toBeNull();
      expect(info?.customMetadata?.version).toBe("1");
      expect(info?.httpMetadata?.contentType).toContain("json");
    }).pipe(
      Effect.provide(R2.json(UserSchema).layer(memoryR2()))
    ) as Effect.Effect<void>
);
