/**
 * Basic Worker Example
 *
 * Demonstrates:
 * - Worker.serve with Effect v4
 * - KV namespace usage (get, put, delete)
 * - D1 database usage (query, queryFirst)
 * - Layer composition
 * - Tagged error handling
 */

import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { Effect, Layer, Schema } from "effect";
import { D1 } from "../../../src/D1.js";
import { KV } from "../../../src/KV.js";
import { serve } from "../../../src/Worker.js";

// ── Environment Type ────────────────────────────────────────────────────────

interface Env {
  readonly MY_DB: D1Database;
  readonly MY_KV: KVNamespace;
}

// ── User Schema ────────────────────────────────────────────────────────────

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  createdAt: Schema.String,
});

type User = typeof User.Type;

// ── Route Patterns ────────────────────────────────────────────────────────

const USER_BY_ID_PATTERN = /^\/users\/([^/]+)$/;

// ── Route Handlers ────────────────────────────────────────────────────────

/**
 * GET /users/:id
 * Fetch user from KV (with schema validation)
 */
const getUser = (userId: string) =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const user = yield* kv.get(userId);

    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json(user);
  });

/**
 * POST /users
 * Create a new user (store in KV and D1)
 */
const createUser = (data: { name: string; email: string }) =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const db = yield* D1;

    // Generate ID and timestamp
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const user: User = {
      id,
      name: data.name,
      email: data.email,
      createdAt,
    };

    // Store in KV (with automatic JSON serialization)
    yield* kv.put(id, user);

    // Store in D1 (create table if not exists)
    yield* db.exec(`
			CREATE TABLE IF NOT EXISTS users (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT NOT NULL,
				created_at TEXT NOT NULL
			)
		`);

    yield* db.query(
      "INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)",
      [id, data.name, data.email, createdAt]
    );

    return Response.json(user, { status: 201 });
  });

/**
 * GET /users
 * List all users from D1
 */
const listUsers = () =>
  Effect.gen(function* () {
    const db = yield* D1;

    // Ensure table exists
    yield* db.exec(`
			CREATE TABLE IF NOT EXISTS users (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT NOT NULL,
				created_at TEXT NOT NULL
			)
		`);

    // Query all users
    const users = yield* db.query<User>(
      "SELECT * FROM users ORDER BY created_at DESC"
    );

    return Response.json({ users });
  });

/**
 * DELETE /users/:id
 * Delete user from both KV and D1
 */
const deleteUser = (userId: string) =>
  Effect.gen(function* () {
    const kv = yield* KV;
    const db = yield* D1;

    // Delete from KV
    yield* kv.delete(userId);

    // Delete from D1
    yield* db.query("DELETE FROM users WHERE id = ?", [userId]);

    return Response.json({ message: "User deleted" });
  });

// ── Router ────────────────────────────────────────────────────────────────

const handler = (request: Request) =>
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Router with multiple endpoints
  Effect.gen(function* () {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // GET /
    if (path === "/" && method === "GET") {
      return Response.json({
        message: "effectful-cloudflare basic example",
        endpoints: {
          "GET /users": "List all users",
          "GET /users/:id": "Get user by ID",
          "POST /users": "Create user (body: { name, email })",
          "DELETE /users/:id": "Delete user",
        },
      });
    }

    // GET /users
    if (path === "/users" && method === "GET") {
      return yield* listUsers();
    }

    // POST /users
    if (path === "/users" && method === "POST") {
      const data = (yield* Effect.tryPromise(() => request.json())) as {
        name: string;
        email: string;
      };
      return yield* createUser(data);
    }

    // GET /users/:id
    const getUserMatch = path.match(USER_BY_ID_PATTERN);
    if (getUserMatch && method === "GET") {
      const userId = getUserMatch[1];
      if (!userId) {
        return Response.json({ error: "Invalid user ID" }, { status: 400 });
      }
      return yield* getUser(userId);
    }

    // DELETE /users/:id
    const deleteUserMatch = path.match(USER_BY_ID_PATTERN);
    if (deleteUserMatch && method === "DELETE") {
      const userId = deleteUserMatch[1];
      if (!userId) {
        return Response.json({ error: "Invalid user ID" }, { status: 400 });
      }
      return yield* deleteUser(userId);
    }

    // 404
    return Response.json({ error: "Not found" }, { status: 404 });
  });

// ── Worker Export ────────────────────────────────────────────────────────

export default serve(handler, (env) =>
  Layer.mergeAll(
    // KV layer with User schema validation
    KV.layer((env as unknown as Env).MY_KV, User),
    // D1 layer
    D1.layer((env as unknown as Env).MY_DB)
  )
);
