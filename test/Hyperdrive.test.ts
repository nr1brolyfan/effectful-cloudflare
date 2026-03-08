import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { HyperdriveBinding } from "../src/Hyperdrive.js";
import { Hyperdrive } from "../src/Hyperdrive.js";

// ── Mock binding ────────────────────────────────────────────────────────

const mockBinding: HyperdriveBinding = {
  connectionString:
    "postgresql://testuser:testpass@testhost:5432/testdb?sslmode=require",
  host: "testhost",
  port: 5432,
  user: "testuser",
  password: "testpass",
  database: "testdb",
};

// ── Basic operations ────────────────────────────────────────────────────

it.effect("connectionString returns the full connection string", () =>
  Effect.gen(function* () {
    const hyperdrive = yield* Hyperdrive;

    const connString = yield* hyperdrive.connectionString;

    expect(connString).toBe(
      "postgresql://testuser:testpass@testhost:5432/testdb?sslmode=require"
    );
  }).pipe(Effect.provide(Hyperdrive.layer(mockBinding)))
);

it.effect("connectionInfo returns connection details without credentials", () =>
  Effect.gen(function* () {
    const hyperdrive = yield* Hyperdrive;

    const info = yield* hyperdrive.connectionInfo;

    expect(info.host).toBe("testhost");
    expect(info.port).toBe(5432);
    expect(info.database).toBe("testdb");
    // Verify password is not included
    expect(Object.keys(info)).not.toContain("password");
    expect(Object.keys(info)).not.toContain("user");
  }).pipe(Effect.provide(Hyperdrive.layer(mockBinding)))
);

it.effect("connectionString can be called multiple times", () =>
  Effect.gen(function* () {
    const hyperdrive = yield* Hyperdrive;

    const connString1 = yield* hyperdrive.connectionString;
    const connString2 = yield* hyperdrive.connectionString;

    expect(connString1).toBe(connString2);
    expect(connString1).toBe(
      "postgresql://testuser:testpass@testhost:5432/testdb?sslmode=require"
    );
  }).pipe(Effect.provide(Hyperdrive.layer(mockBinding)))
);

it.effect("connectionInfo can be called multiple times", () =>
  Effect.gen(function* () {
    const hyperdrive = yield* Hyperdrive;

    const info1 = yield* hyperdrive.connectionInfo;
    const info2 = yield* hyperdrive.connectionInfo;

    expect(info1).toEqual(info2);
    expect(info1.host).toBe("testhost");
  }).pipe(Effect.provide(Hyperdrive.layer(mockBinding)))
);

// ── Different binding configurations ────────────────────────────────────

it.effect("works with production-style connection strings", () => {
  const prodBinding: HyperdriveBinding = {
    connectionString:
      "postgresql://prod_user:prod_pass@db.example.com:5432/production?sslmode=require&pool_timeout=10",
    host: "db.example.com",
    port: 5432,
    user: "prod_user",
    password: "prod_pass",
    database: "production",
  };

  return Effect.gen(function* () {
    const hyperdrive = yield* Hyperdrive;

    const connString = yield* hyperdrive.connectionString;
    const info = yield* hyperdrive.connectionInfo;

    expect(connString).toContain("db.example.com");
    expect(connString).toContain("production");
    expect(info.host).toBe("db.example.com");
    expect(info.database).toBe("production");
  }).pipe(Effect.provide(Hyperdrive.layer(prodBinding)));
});

it.effect("works with non-standard port", () => {
  const customPortBinding: HyperdriveBinding = {
    connectionString: "postgresql://user:pass@customhost:3306/db",
    host: "customhost",
    port: 3306,
    user: "user",
    password: "pass",
    database: "db",
  };

  return Effect.gen(function* () {
    const hyperdrive = yield* Hyperdrive;

    const info = yield* hyperdrive.connectionInfo;

    expect(info.port).toBe(3306);
    expect(info.host).toBe("customhost");
  }).pipe(Effect.provide(Hyperdrive.layer(customPortBinding)));
});

// ── Error handling ──────────────────────────────────────────────────────

it.effect("wraps errors when binding throws on connectionString access", () =>
  Effect.gen(function* () {
    const failingBinding = {
      get connectionString(): string {
        throw new Error("Binding access failed");
      },
      host: "host",
      port: 5432,
      user: "user",
      password: "pass",
      database: "db",
    };

    const error = yield* Effect.gen(function* () {
      const hyperdrive = yield* Hyperdrive;
      yield* hyperdrive.connectionString;
    })
      .pipe(Effect.provide(Hyperdrive.layer(failingBinding)))
      .pipe(Effect.flip);

    expect(error._tag).toBe("HyperdriveError");
    expect(error.operation).toBe("connectionString");
    expect(error.message).toContain("Failed to read connection string");
  })
);

it.effect("wraps errors when binding throws on connectionInfo access", () =>
  Effect.gen(function* () {
    const failingBinding = {
      connectionString: "postgresql://user:pass@host:5432/db",
      get host(): string {
        throw new Error("Host access failed");
      },
      port: 5432,
      user: "user",
      password: "pass",
      database: "db",
    };

    const error = yield* Effect.gen(function* () {
      const hyperdrive = yield* Hyperdrive;
      yield* hyperdrive.connectionInfo;
    })
      .pipe(Effect.provide(Hyperdrive.layer(failingBinding)))
      .pipe(Effect.flip);

    expect(error._tag).toBe("HyperdriveError");
    expect(error.operation).toBe("connectionInfo");
    expect(error.message).toContain("Failed to read connection info");
  })
);
