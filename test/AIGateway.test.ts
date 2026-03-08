import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import type { AIGatewayBinding } from "../src/AIGateway.js";
import { AIGateway } from "../src/AIGateway.js";
import * as Testing from "../src/Testing.js";

describe("AIGateway", () => {
  describe("run", () => {
    it.effect("sends request through AI Gateway and returns response", () => {
      const binding = Testing.memoryAIGateway({
        responses: {
          openai: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Hello! How can I help you today?",
                },
              },
            ],
          },
        },
      });

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const response = yield* gateway.run({
          provider: "openai",
          endpoint: "/v1/chat/completions",
          query: {
            model: "gpt-4",
            messages: [{ role: "user", content: "Hi" }],
          },
        });

        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);

        const data = yield* Effect.promise(() => response.json());
        expect(data).toEqual({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Hello! How can I help you today?",
              },
            },
          ],
        });

        // Verify log ID is present in response headers
        const logId = response.headers.get("cf-aig-log-id");
        expect(logId).toBeTruthy();
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect("returns default mock response for unknown provider", () => {
      const binding = Testing.memoryAIGateway();

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const response = yield* gateway.run({
          provider: "unknown-provider",
          endpoint: "/v1/completions",
          query: { prompt: "test" },
        });

        expect(response.ok).toBe(true);
        const data = yield* Effect.promise(() => response.json());
        expect(data).toEqual({
          success: true,
          result: "Mock AI Gateway response",
        });
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect("includes custom headers in response", () => {
      const binding = Testing.memoryAIGateway({
        responses: {
          anthropic: {
            content: [{ type: "text", text: "Hello from Claude!" }],
          },
        },
      });

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const response = yield* gateway.run({
          provider: "anthropic",
          endpoint: "/v1/messages",
          headers: {
            "anthropic-version": "2023-06-01",
          },
          query: {
            model: "claude-3-opus",
            messages: [{ role: "user", content: "Hello" }],
          },
        });

        expect(response.ok).toBe(true);
        expect(response.headers.get("Content-Type")).toBe("application/json");
        expect(response.headers.get("cf-aig-log-id")).toBeTruthy();
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });
  });

  describe("runBatch", () => {
    it.effect("sends batch of requests and returns combined response", () => {
      const binding = Testing.memoryAIGateway({
        responses: {
          openai: {
            choices: [
              { message: { role: "assistant", content: "Response 1" } },
            ],
          },
          anthropic: {
            content: [{ type: "text", text: "Response 2" }],
          },
        },
      });

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const response = yield* gateway.runBatch([
          {
            provider: "openai",
            endpoint: "/v1/chat/completions",
            query: {
              model: "gpt-4",
              messages: [{ role: "user", content: "Test 1" }],
            },
          },
          {
            provider: "anthropic",
            endpoint: "/v1/messages",
            query: {
              model: "claude-3-opus",
              messages: [{ role: "user", content: "Test 2" }],
            },
          },
        ]);

        expect(response.ok).toBe(true);
        const data = yield* Effect.promise(() => response.json());
        expect(Array.isArray(data)).toBe(true);
        expect(data).toHaveLength(2);
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect("handles empty batch", () => {
      const binding = Testing.memoryAIGateway();

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const response = yield* gateway.runBatch([]);

        expect(response.ok).toBe(true);
        const data = yield* Effect.promise(() => response.json());
        expect(Array.isArray(data)).toBe(true);
        expect(data).toHaveLength(0);
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });
  });

  describe("getLog", () => {
    it.effect("retrieves log entry by ID", () => {
      const binding = Testing.memoryAIGateway({
        responses: {
          openai: {
            choices: [
              { message: { role: "assistant", content: "Test response" } },
            ],
          },
        },
      });

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        // First, make a request to generate a log
        const response = yield* gateway.run({
          provider: "openai",
          endpoint: "/v1/chat/completions",
          query: {
            model: "gpt-4",
            messages: [{ role: "user", content: "Hello" }],
          },
        });

        const logId = response.headers.get("cf-aig-log-id");
        expect(logId).toBeTruthy();

        // Now retrieve the log
        if (logId) {
          const log = yield* gateway.getLog(logId);

          expect(log.id).toBe(logId);
          expect(log.provider).toBe("openai");
          expect(log.model).toBe("gpt-4");
          expect(log.status_code).toBe(200);
          expect(log.created_at).toBeTruthy();
          expect(log.request.messages).toEqual([
            { role: "user", content: "Hello" },
          ]);
        }
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect(
      "fails with AIGatewayRequestError for non-existent log ID",
      () => {
        const binding = Testing.memoryAIGateway();

        return Effect.gen(function* () {
          const gateway = yield* AIGateway;

          const result = yield* gateway
            .getLog("non-existent-log-id")
            .pipe(Effect.flip);

          expect(result._tag).toBe("AIGatewayRequestError");
          if (result._tag === "AIGatewayRequestError") {
            expect(result.operation).toBe("getLog");
            expect(result.message).toContain("non-existent-log-id");
          }
        }).pipe(Effect.provide(AIGateway.layer(binding)));
      }
    );
  });

  describe("patchLog", () => {
    it.effect("updates log with custom metadata", () => {
      const binding = Testing.memoryAIGateway({
        responses: {
          openai: {
            choices: [{ message: { role: "assistant", content: "Response" } }],
          },
        },
      });

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        // Make a request to generate a log
        const response = yield* gateway.run({
          provider: "openai",
          endpoint: "/v1/chat/completions",
          query: {
            model: "gpt-4",
            messages: [{ role: "user", content: "Test" }],
          },
        });

        const logId = response.headers.get("cf-aig-log-id");
        expect(logId).toBeTruthy();

        if (logId) {
          // Patch the log with metadata
          yield* gateway.patchLog(logId, {
            metadata: { helpful: true, category: "test" },
            score: 5,
          });

          // Retrieve the updated log
          const updatedLog = yield* gateway.getLog(logId);
          expect(updatedLog.metadata).toEqual({
            helpful: true,
            category: "test",
          });
          expect(updatedLog.cost).toBe(5);
        }
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect("updates log with feedback score", () => {
      const binding = Testing.memoryAIGateway({
        responses: {
          anthropic: {
            content: [{ type: "text", text: "Great response!" }],
          },
        },
      });

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const response = yield* gateway.run({
          provider: "anthropic",
          endpoint: "/v1/messages",
          query: {
            model: "claude-3-opus",
            messages: [{ role: "user", content: "Help me" }],
          },
        });

        const logId = response.headers.get("cf-aig-log-id");

        if (logId) {
          yield* gateway.patchLog(logId, { score: 10 });

          const log = yield* gateway.getLog(logId);
          expect(log.cost).toBe(10);
        }
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect(
      "fails with AIGatewayRequestError for non-existent log ID",
      () => {
        const binding = Testing.memoryAIGateway();

        return Effect.gen(function* () {
          const gateway = yield* AIGateway;

          const result = yield* gateway
            .patchLog("non-existent-log-id", { score: 5 })
            .pipe(Effect.flip);

          expect(result._tag).toBe("AIGatewayRequestError");
          if (result._tag === "AIGatewayRequestError") {
            expect(result.operation).toBe("patchLog");
          }
        }).pipe(Effect.provide(AIGateway.layer(binding)));
      }
    );
  });

  describe("getUrl", () => {
    it.effect("returns base gateway URL without provider", () => {
      const binding = Testing.memoryAIGateway();

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const url = yield* gateway.getUrl();

        expect(url).toBe("https://gateway.ai.cloudflare.com");
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect("returns provider-specific gateway URL", () => {
      const binding = Testing.memoryAIGateway();

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const openaiUrl = yield* gateway.getUrl("openai");
        const anthropicUrl = yield* gateway.getUrl("anthropic");

        expect(openaiUrl).toBe("https://gateway.ai.cloudflare.com/openai");
        expect(anthropicUrl).toBe(
          "https://gateway.ai.cloudflare.com/anthropic"
        );
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect("supports custom gateway URL", () => {
      const binding = Testing.memoryAIGateway({
        gatewayUrl: "https://custom-gateway.example.com",
      });

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const url = yield* gateway.getUrl();
        const providerUrl = yield* gateway.getUrl("openai");

        expect(url).toBe("https://custom-gateway.example.com");
        expect(providerUrl).toBe("https://custom-gateway.example.com/openai");
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });
  });

  describe("error handling", () => {
    it.effect("wraps binding errors in AIGatewayRequestError", () => {
      const binding: AIGatewayBinding = {
        run: () => Promise.reject(new Error("Network error")),
        getLog: () => Promise.reject(new Error("Log not found")),
        patchLog: () => Promise.reject(new Error("Patch failed")),
        getUrl: () => Promise.reject(new Error("URL generation failed")),
      };

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const result = yield* gateway
          .run({
            provider: "openai",
            endpoint: "/v1/completions",
            query: { prompt: "test" },
          })
          .pipe(Effect.flip);

        expect(result._tag).toBe("AIGatewayRequestError");
        if (result._tag === "AIGatewayRequestError") {
          expect(result.operation).toBe("run");
          expect(result.message).toContain("Failed to send request");
        }
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect("can catch AIGatewayRequestError with catchTag", () => {
      const binding: AIGatewayBinding = {
        run: () => Promise.reject(new Error("Gateway unavailable")),
        getLog: () => Promise.resolve({} as any),
        patchLog: () => Promise.resolve(),
        getUrl: () => Promise.resolve(""),
      };

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const result = yield* gateway
          .run({
            provider: "openai",
            endpoint: "/v1/completions",
            query: { prompt: "test" },
          })
          .pipe(
            Effect.catchTag("AIGatewayRequestError", (error) =>
              Effect.succeed(`Error: ${error.operation} failed`)
            )
          );

        expect(result).toBe("Error: run failed");
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect("handles non-ok responses with AIGatewayResponseError", () => {
      const binding: AIGatewayBinding = {
        run: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: { message: "Rate limit exceeded" } }),
              {
                status: 429,
                statusText: "Too Many Requests",
              }
            )
          ),
        getLog: () => Promise.resolve({} as any),
        patchLog: () => Promise.resolve(),
        getUrl: () => Promise.resolve(""),
      };

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const result = yield* gateway
          .run({
            provider: "openai",
            endpoint: "/v1/completions",
            query: { prompt: "test" },
          })
          .pipe(Effect.flip);

        expect(result._tag).toBe("AIGatewayResponseError");
        if (result._tag === "AIGatewayResponseError") {
          expect(result.status).toBe(429);
          expect(result.message).toContain("429");
          expect(result.operation).toBe("run");
        }
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });

    it.effect("can catch AIGatewayResponseError with catchTag", () => {
      const binding: AIGatewayBinding = {
        run: () =>
          Promise.resolve(
            new Response(JSON.stringify({ error: "Server error" }), {
              status: 500,
              statusText: "Internal Server Error",
            })
          ),
        getLog: () => Promise.resolve({} as any),
        patchLog: () => Promise.resolve(),
        getUrl: () => Promise.resolve(""),
      };

      return Effect.gen(function* () {
        const gateway = yield* AIGateway;

        const result = yield* gateway
          .run({
            provider: "openai",
            endpoint: "/v1/completions",
            query: { prompt: "test" },
          })
          .pipe(
            Effect.catchTag("AIGatewayResponseError", (error) =>
              Effect.succeed(
                `Gateway returned error: ${error.status} ${error.statusText}`
              )
            )
          );

        expect(result).toBe(
          "Gateway returned error: 500 Internal Server Error"
        );
      }).pipe(Effect.provide(AIGateway.layer(binding)));
    });
  });
});
