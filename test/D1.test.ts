import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { D1 } from "../src/D1.js";
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
    expect(users[0]?.email).toBe("alice@example.com");
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
