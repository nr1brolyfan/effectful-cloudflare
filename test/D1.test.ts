import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { D1, type D1Binding, type D1PreparedStatement } from "../src/D1.js";
import { memoryD1 } from "../src/Testing.js";

// ── Basic query operations ──────────────────────────────────────────────

it.effect("query returns all rows", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    // Create table and insert test data
    yield* db.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)"
    );
    yield* db.exec(
      "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')"
    );
    yield* db.exec(
      "INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@example.com')"
    );

    // Query all users
    const users = yield* db.query<{ id: number; name: string; email: string }>(
      "SELECT * FROM users"
    );

    expect(users).toHaveLength(2);
    expect(users[0]?.name).toBe("Alice");
    expect(users[1]?.name).toBe("Bob");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("query with WHERE clause and params", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    yield* db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
    yield* db.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')");

    const users = yield* db.query<{ id: number; name: string }>(
      "SELECT * FROM users WHERE id = ?",
      [1]
    );

    expect(users).toHaveLength(1);
    expect(users[0]?.name).toBe("Alice");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("query returns empty array when no rows match", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

    const users = yield* db.query<{ id: number; name: string }>(
      "SELECT * FROM users"
    );

    expect(users).toHaveLength(0);
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

// ── queryFirst operations ───────────────────────────────────────────────

it.effect("queryFirst returns first row", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    yield* db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
    yield* db.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')");

    const user = yield* db.queryFirst<{ id: number; name: string }>(
      "SELECT * FROM users WHERE id = ?",
      [1]
    );

    expect(user).not.toBeNull();
    expect(user?.name).toBe("Alice");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("queryFirst returns null when no rows match", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

    const user = yield* db.queryFirst<{ id: number; name: string }>(
      "SELECT * FROM users WHERE id = ?",
      [999]
    );

    expect(user).toBeNull();
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

// ── queryFirstOrFail operations ─────────────────────────────────────────

it.effect("queryFirstOrFail returns row when found", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    yield* db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");

    const user = yield* db.queryFirstOrFail<{ id: number; name: string }>(
      "SELECT * FROM users WHERE id = ?",
      [1]
    );

    expect(user.name).toBe("Alice");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("queryFirstOrFail fails with NotFoundError when no row found", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

    const result = yield* db
      .queryFirstOrFail<{ id: number; name: string }>(
        "SELECT * FROM users WHERE id = ?",
        [999]
      )
      .pipe(Effect.flip);

    expect(result._tag).toBe("NotFoundError");
    if (result._tag === "NotFoundError") {
      expect(result.resource).toBe("D1");
    }
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("queryFirstOrFail can be caught with catchTag", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

    const result = yield* db
      .queryFirstOrFail<{ id: number; name: string }>(
        "SELECT * FROM users WHERE id = ?",
        [999]
      )
      .pipe(
        Effect.catchTag("NotFoundError", (error) =>
          Effect.succeed({ id: 0, name: `Not found: ${error.key}` })
        )
      );

    expect(result.name).toContain("Not found");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

// ── Batch operations ────────────────────────────────────────────────────

it.effect("batch executes multiple statements atomically", () => {
  const binding = memoryD1();

  return Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

    const stmt1 = binding
      .prepare("INSERT INTO users (id, name) VALUES (?, ?)")
      .bind(1, "Alice");
    const stmt2 = binding
      .prepare("INSERT INTO users (id, name) VALUES (?, ?)")
      .bind(2, "Bob");

    yield* db.batch([stmt1, stmt2]);

    const users = yield* db.query<{ id: number; name: string }>(
      "SELECT * FROM users"
    );

    expect(users).toHaveLength(2);
  }).pipe(Effect.provide(D1.layer(binding)));
});

// ── exec operations ─────────────────────────────────────────────────────

it.effect("exec creates table", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    const result = yield* db.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)"
    );

    expect(result.count).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("exec executes multiple statements", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    const result = yield* db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);
    `);

    expect(result.count).toBe(2);
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

// ── Complex workflow ────────────────────────────────────────────────────

it.effect("complex workflow - create, insert, query, update", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    // Create table
    yield* db.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, active INTEGER DEFAULT 1)"
    );

    // Insert users with explicit active values
    yield* db.exec(
      "INSERT INTO users (id, name, active) VALUES (1, 'Alice', 1)"
    );
    yield* db.exec("INSERT INTO users (id, name, active) VALUES (2, 'Bob', 1)");
    yield* db.exec(
      "INSERT INTO users (id, name, active) VALUES (3, 'Charlie', 0)"
    );

    // Query all users
    const allUsers = yield* db.query<{
      id: number;
      name: string;
      active: number;
    }>("SELECT * FROM users");
    expect(allUsers).toHaveLength(3);

    // Query first user
    const firstUser = yield* db.queryFirst<{ id: number; name: string }>(
      "SELECT * FROM users WHERE id = ?",
      [1]
    );
    expect(firstUser?.name).toBe("Alice");

    // Query active users only
    const activeUsers = yield* db.query<{ id: number; name: string }>(
      "SELECT * FROM users WHERE active = ?",
      [1]
    );
    expect(activeUsers).toHaveLength(2);
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

// ── Schema-validated queries ────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.String,
});

it.effect("querySchema validates and returns typed results", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)"
    );
    yield* db.exec(
      "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')"
    );
    yield* db.exec(
      "INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@example.com')"
    );

    const users = yield* db.querySchema(UserSchema, "SELECT * FROM users");

    expect(users).toHaveLength(2);
    expect(users[0]?.name).toBe("Alice");
    expect(users[1]?.name).toBe("Bob");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

// ── Binding error handling ──────────────────────────────────────────────

const createFailingPreparedStmt = (): D1PreparedStatement => ({
  bind: () => createFailingPreparedStmt(),
  all: () => Promise.reject(new Error("D1 query failed")),
  run: () => Promise.reject(new Error("D1 run failed")),
  first: () => Promise.reject(new Error("D1 first failed")),
});

const createErrorD1Binding = (): D1Binding => ({
  prepare: () => createFailingPreparedStmt(),
  batch: () => Promise.reject(new Error("D1 batch failed")),
  exec: () => Promise.reject(new Error("D1 exec failed")),
  dump: () => Promise.reject(new Error("D1 dump failed")),
});

it.effect("D1QueryError on query binding failure", () =>
  Effect.gen(function* () {
    const db = yield* D1;
    const error = yield* db.query("SELECT * FROM users").pipe(Effect.flip);
    expect(error._tag).toBe("D1QueryError");
    if (error._tag === "D1QueryError") {
      expect(error.sql).toBe("SELECT * FROM users");
      expect(error.message).toContain("D1 query failed");
    }
  }).pipe(Effect.provide(D1.layer(createErrorD1Binding())))
);

it.effect("D1QueryError on queryFirst binding failure", () =>
  Effect.gen(function* () {
    const db = yield* D1;
    const error = yield* db
      .queryFirst("SELECT * FROM users WHERE id = ?", [1])
      .pipe(Effect.flip);
    expect(error._tag).toBe("D1QueryError");
    if (error._tag === "D1QueryError") {
      expect(error.sql).toBe("SELECT * FROM users WHERE id = ?");
      expect(error.params).toEqual([1]);
    }
  }).pipe(Effect.provide(D1.layer(createErrorD1Binding())))
);

it.effect("D1QueryError on queryFirstOrFail binding failure", () =>
  Effect.gen(function* () {
    const db = yield* D1;
    const error = yield* db
      .queryFirstOrFail("SELECT * FROM users WHERE id = ?", [1])
      .pipe(Effect.flip);
    expect(error._tag).toBe("D1QueryError");
  }).pipe(Effect.provide(D1.layer(createErrorD1Binding())))
);

it.effect("D1Error on exec binding failure", () =>
  Effect.gen(function* () {
    const db = yield* D1;
    const error = yield* db
      .exec("CREATE TABLE users (id INTEGER)")
      .pipe(Effect.flip);
    expect(error._tag).toBe("D1Error");
    if (error._tag === "D1Error") {
      expect(error.operation).toBe("exec");
      expect(error.message).toContain("D1 exec failed");
    }
  }).pipe(Effect.provide(D1.layer(createErrorD1Binding())))
);

it.effect("D1Error on batch binding failure", () =>
  Effect.gen(function* () {
    const db = yield* D1;
    const error = yield* db.batch([]).pipe(Effect.flip);
    expect(error._tag).toBe("D1Error");
    if (error._tag === "D1Error") {
      expect(error.operation).toBe("batch");
    }
  }).pipe(Effect.provide(D1.layer(createErrorD1Binding())))
);

it.effect("D1QueryError can be caught with catchTag", () =>
  Effect.gen(function* () {
    const db = yield* D1;
    const result = yield* db
      .query("SELECT * FROM users")
      .pipe(
        Effect.catchTag("D1QueryError", (error) =>
          Effect.succeed(`Caught: ${error.sql}`)
        )
      );
    expect(result).toBe("Caught: SELECT * FROM users");
  }).pipe(Effect.provide(D1.layer(createErrorD1Binding())))
);

it.effect("D1Error can be caught with catchTag", () =>
  Effect.gen(function* () {
    const db = yield* D1;
    const result = yield* db
      .exec("DROP TABLE users")
      .pipe(
        Effect.catchTag("D1Error", (error) =>
          Effect.succeed(`Caught: ${error.operation}`)
        )
      );
    expect(result).toBe("Caught: exec");
  }).pipe(Effect.provide(D1.layer(createErrorD1Binding())))
);

it.effect("D1QueryError includes cause from binding", () =>
  Effect.gen(function* () {
    const db = yield* D1;
    const error = yield* db.query("SELECT 1").pipe(Effect.flip);
    if (error._tag === "D1QueryError") {
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toBe("D1 query failed");
    }
  }).pipe(Effect.provide(D1.layer(createErrorD1Binding())))
);

// ── Schema validation failures ──────────────────────────────────────────

it.effect("querySchema fails with SchemaError on invalid data", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)"
    );
    yield* db.exec(
      "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')"
    );

    // Use a schema that will fail - email expects a number
    const BadSchema = Schema.Struct({
      id: Schema.Number,
      name: Schema.Number, // name is string, schema expects number
      email: Schema.String,
    });

    const error = yield* db
      .querySchema(BadSchema, "SELECT * FROM users")
      .pipe(Effect.flip);
    expect(error._tag).toBe("SchemaError");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("querySchema SchemaError can be caught with catchTag", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec("CREATE TABLE items (id INTEGER, name TEXT)");
    yield* db.exec("INSERT INTO items (id, name) VALUES (1, 'Widget')");

    const BadSchema = Schema.Struct({
      id: Schema.String, // expects string, but id is number
      name: Schema.String,
    });

    const result = yield* db
      .querySchema(BadSchema, "SELECT * FROM items")
      .pipe(
        Effect.catchTag("SchemaError", (error) =>
          Effect.succeed(`Schema error: ${error.message}`)
        )
      );
    expect(result).toContain("Schema error:");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

// ── Edge cases ──────────────────────────────────────────────────────────

it.effect("query with no params works", () =>
  Effect.gen(function* () {
    const db = yield* D1;
    yield* db.exec("CREATE TABLE items (id INTEGER)");
    const items = yield* db.query("SELECT * FROM items");
    expect(items).toEqual([]);
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("migrate with empty migrations array", () =>
  Effect.gen(function* () {
    const db = yield* D1;
    yield* db.migrate([]);
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("queryFirstSchema returns typed first row", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)"
    );
    yield* db.exec(
      "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')"
    );

    const user = yield* db.queryFirstSchema(
      UserSchema,
      "SELECT * FROM users WHERE id = ?",
      [1]
    );

    expect(user).not.toBeNull();
    expect(user?.name).toBe("Alice");
    expect(user?.email).toBe("alice@example.com");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("queryFirstSchema returns null when no row found", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)"
    );

    const user = yield* db.queryFirstSchema(
      UserSchema,
      "SELECT * FROM users WHERE id = ?",
      [999]
    );

    expect(user).toBeNull();
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

// ── Migration runner ────────────────────────────────────────────────────

it.effect("migrate creates migrations table and runs pending migrations", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    const migrations = [
      {
        name: "001_create_users_table",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
      },
      {
        name: "002_create_posts_table",
        sql: "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)",
      },
    ];

    yield* db.migrate(migrations);

    // Verify tables were created
    const users = yield* db.query("SELECT * FROM users");
    const posts = yield* db.query("SELECT * FROM posts");

    expect(users).toEqual([]);
    expect(posts).toEqual([]);

    // Verify migrations table exists and tracks migrations
    const appliedMigrations = yield* db.query<{ name: string }>(
      "SELECT name FROM __migrations ORDER BY name"
    );

    expect(appliedMigrations).toHaveLength(2);
    expect(appliedMigrations[0]?.name).toBe("001_create_users_table");
    expect(appliedMigrations[1]?.name).toBe("002_create_posts_table");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("migrate skips already applied migrations", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    const migration1 = {
      name: "001_create_users_table",
      sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
    };

    // Run first migration
    yield* db.migrate([migration1]);

    // Run migrations again with an additional migration
    const migrations = [
      migration1,
      {
        name: "002_create_posts_table",
        sql: "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)",
      },
    ];

    yield* db.migrate(migrations);

    // Verify both tables exist
    const users = yield* db.query("SELECT * FROM users");
    const posts = yield* db.query("SELECT * FROM posts");

    expect(users).toEqual([]);
    expect(posts).toEqual([]);

    // Verify migrations table has both migrations
    const appliedMigrations = yield* db.query<{ name: string }>(
      "SELECT name FROM __migrations ORDER BY name"
    );

    expect(appliedMigrations).toHaveLength(2);
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

// ── exec whitespace normalization ───────────────────────────────────────

it.effect("exec preserves string literals with multiple spaces", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    yield* db.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY, message TEXT)");

    // String literal with multiple spaces should be preserved
    yield* db.exec(
      "INSERT INTO logs (id, message) VALUES (1, 'hello   world')"
    );

    const logs = yield* db.query<{ id: number; message: string }>(
      "SELECT * FROM logs WHERE id = ?",
      [1]
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe("hello   world");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

it.effect("exec normalizes whitespace outside string literals", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    // Use template literal with indentation — whitespace outside strings
    // should be collapsed, but strings preserved
    yield* db.exec(`
      CREATE TABLE   test   (id INTEGER PRIMARY KEY, name TEXT)
    `);

    yield* db.exec(`
      INSERT INTO test (id, name) VALUES (1, 'Alice   Smith')
    `);

    const rows = yield* db.query<{ id: number; name: string }>(
      "SELECT * FROM test WHERE id = ?",
      [1]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Alice   Smith");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);

// ── Migration runner ────────────────────────────────────────────────────

it.effect("migrate runs migrations in order", () =>
  Effect.gen(function* () {
    const db = yield* D1;

    const migrations = [
      {
        name: "001_create_users_table",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
      },
      {
        name: "002_add_user",
        sql: "INSERT INTO users (id, name) VALUES (1, 'Alice')",
      },
      {
        name: "003_add_another_user",
        sql: "INSERT INTO users (id, name) VALUES (2, 'Bob')",
      },
    ];

    yield* db.migrate(migrations);

    // Verify users were inserted in order
    const users = yield* db.query<{ id: number; name: string }>(
      "SELECT * FROM users ORDER BY id"
    );

    expect(users).toHaveLength(2);
    expect(users[0]?.name).toBe("Alice");
    expect(users[1]?.name).toBe("Bob");
  }).pipe(Effect.provide(D1.layer(memoryD1())))
);
