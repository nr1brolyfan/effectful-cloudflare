import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";
import type { AIBinding } from "../src/AI.js";
import { AI } from "../src/AI.js";
import * as Testing from "../src/Testing.js";

describe("AI", () => {
  describe("run", () => {
    it.effect("runs AI model and returns raw response", () => {
      const binding = Testing.memoryAI({
        responses: {
          "@cf/meta/llama-3-8b-instruct": {
            response: "Paris is the capital of France.",
          },
        },
      });

      return Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai.run<{ response: string }>(
          "@cf/meta/llama-3-8b-instruct",
          { prompt: "What is the capital of France?" }
        );

        expect(result.response).toBe("Paris is the capital of France.");
      }).pipe(Effect.provide(AI.layer(binding)));
    });

    it.effect("returns default mock response for unknown model", () => {
      const binding = Testing.memoryAI();

      return Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai.run<{ success: boolean; result: string }>(
          "@cf/unknown/model",
          { input: "test" }
        );

        expect(result.success).toBe(true);
        expect(result.result).toBe("Mock AI response");
      }).pipe(Effect.provide(AI.layer(binding)));
    });

    it.effect("supports streaming option", () => {
      const binding = Testing.memoryAI({
        responses: {
          "@cf/meta/llama-3-8b-instruct": {
            response: "Streaming response",
          },
        },
      });

      return Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai.run<ReadableStream>(
          "@cf/meta/llama-3-8b-instruct",
          { prompt: "test" },
          { stream: true }
        );

        expect(result).toBeInstanceOf(ReadableStream);
      }).pipe(Effect.provide(AI.layer(binding)));
    });
  });

  describe("runSchema", () => {
    it.effect("runs model and validates response with schema", () => {
      const ResponseSchema = Schema.Struct({
        response: Schema.String,
        confidence: Schema.Number,
      });

      const binding = Testing.memoryAI({
        responses: {
          "@cf/meta/llama-3-8b-instruct": {
            response: "Paris is the capital of France.",
            confidence: 0.95,
          },
        },
      });

      return Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai.runSchema(
          "@cf/meta/llama-3-8b-instruct",
          ResponseSchema,
          { prompt: "What is the capital of France?" }
        );

        expect(result.response).toBe("Paris is the capital of France.");
        expect(result.confidence).toBe(0.95);
        // Type assertion to verify TypeScript inference
        const _typeCheck: {
          response: string;
          confidence: number;
        } = result;
      }).pipe(Effect.provide(AI.layer(binding)));
    });

    it.effect("fails with SchemaError for invalid response", () => {
      const ResponseSchema = Schema.Struct({
        response: Schema.String,
        confidence: Schema.Number,
      });

      const binding = Testing.memoryAI({
        responses: {
          "@cf/meta/llama-3-8b-instruct": {
            response: "Valid string",
            confidence: "not a number", // Invalid - should be number
          },
        },
      });

      return Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai
          .runSchema("@cf/meta/llama-3-8b-instruct", ResponseSchema, {
            prompt: "test",
          })
          .pipe(Effect.flip);

        expect(result._tag).toBe("SchemaError");
        if (result._tag === "SchemaError") {
          expect(result.message).toBe("Failed to decode AI response");
        }
      }).pipe(Effect.provide(AI.layer(binding)));
    });

    it.effect("works with nested schemas", () => {
      const UserSchema = Schema.Struct({
        name: Schema.String,
        age: Schema.Number,
        email: Schema.String,
      });

      const ResponseSchema = Schema.Struct({
        user: UserSchema,
        status: Schema.Literals(["success", "error"]),
      });

      const binding = Testing.memoryAI({
        responses: {
          "@cf/workers-ai/user-extractor": {
            user: {
              name: "Alice",
              age: 30,
              email: "alice@example.com",
            },
            status: "success",
          },
        },
      });

      return Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai.runSchema(
          "@cf/workers-ai/user-extractor",
          ResponseSchema,
          { text: "Extract user from: Alice, 30, alice@example.com" }
        );

        expect(result.user.name).toBe("Alice");
        expect(result.user.age).toBe(30);
        expect(result.user.email).toBe("alice@example.com");
        expect(result.status).toBe("success");
      }).pipe(Effect.provide(AI.layer(binding)));
    });

    it.effect("works with array schemas", () => {
      const ItemSchema = Schema.Struct({
        id: Schema.String,
        score: Schema.Number,
      });

      const ResponseSchema = Schema.Struct({
        items: Schema.Array(ItemSchema),
      });

      const binding = Testing.memoryAI({
        responses: {
          "@cf/workers-ai/ranker": {
            items: [
              { id: "doc1", score: 0.95 },
              { id: "doc2", score: 0.87 },
              { id: "doc3", score: 0.76 },
            ],
          },
        },
      });

      return Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai.runSchema(
          "@cf/workers-ai/ranker",
          ResponseSchema,
          { query: "test query" }
        );

        expect(result.items).toHaveLength(3);
        expect(result.items[0].id).toBe("doc1");
        expect(result.items[0].score).toBe(0.95);
      }).pipe(Effect.provide(AI.layer(binding)));
    });
  });

  describe("error handling", () => {
    it.effect("wraps binding errors in AIError", () => {
      const binding: AIBinding = {
        run: () => Promise.reject(new Error("Model unavailable")),
      };

      return Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai
          .run("@cf/meta/llama-3-8b-instruct", { prompt: "test" })
          .pipe(Effect.flip);

        expect(result._tag).toBe("AIError");
        if (result._tag === "AIError") {
          expect(result.model).toBe("@cf/meta/llama-3-8b-instruct");
          expect(result.operation).toBe("run");
        }
      }).pipe(Effect.provide(AI.layer(binding)));
    });

    it.effect("can catch AIError with catchTag", () => {
      const binding: AIBinding = {
        run: () => Promise.reject(new Error("Model unavailable")),
      };

      return Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai
          .run("@cf/meta/llama-3-8b-instruct", { prompt: "test" })
          .pipe(
            Effect.catchTag("AIError", (error) =>
              Effect.succeed(
                `Error: ${error.operation} failed for ${error.model}`
              )
            )
          );

        expect(result).toBe(
          "Error: run failed for @cf/meta/llama-3-8b-instruct"
        );
      }).pipe(Effect.provide(AI.layer(binding)));
    });

    it.effect("can catch SchemaError from runSchema", () => {
      const ResponseSchema = Schema.Struct({
        response: Schema.String,
      });

      const binding = Testing.memoryAI({
        responses: {
          "@cf/meta/llama-3-8b-instruct": {
            response: 12_345, // Invalid - should be string
          },
        },
      });

      return Effect.gen(function* () {
        const ai = yield* AI;

        const result = yield* ai
          .runSchema("@cf/meta/llama-3-8b-instruct", ResponseSchema, {
            prompt: "test",
          })
          .pipe(
            Effect.catchTag("SchemaError", (error) =>
              Effect.succeed(`Schema validation failed: ${error.message}`)
            )
          );

        expect(result).toBe(
          "Schema validation failed: Failed to decode AI response"
        );
      }).pipe(Effect.provide(AI.layer(binding)));
    });
  });
});
