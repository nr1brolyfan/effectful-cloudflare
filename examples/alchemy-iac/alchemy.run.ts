/**
 * Alchemy IaC Configuration
 *
 * Infrastructure as Code for effectful-cloudflare example worker.
 *
 * This file defines all Cloudflare resources (Worker, KV, D1, R2, Queue)
 * and deploys them using the Alchemy SDK.
 *
 * @see https://alchemy.run - Alchemy documentation
 */

import alchemy from "alchemy";
import {
  D1Database as AlchemyD1,
  KVNamespace as AlchemyKV,
  Queue as AlchemyQueue,
  R2Bucket,
  Worker,
} from "alchemy/cloudflare";
import { config } from "dotenv";

// Load environment variables
config({ path: ".env" });

// ── 1. Initialize Alchemy Application ─────────────────────────────────────

const app = await alchemy("effectful-cloudflare-example", {
  stage: process.env.STAGE || "development",
  password: process.env.ALCHEMY_PASSWORD || "dev-password",
});

const stage = app.stage;

// ── 2. Define Cloudflare Resources ────────────────────────────────────────

/**
 * KV Namespace for caching
 * Used to store cached values with TTL
 */
const cacheKv = await AlchemyKV("cache-kv", {
  title: `effectful-cache-${stage}`,
});

/**
 * D1 Database for analytics
 * Stores analytics events with metadata
 */
const analyticsDb = await AlchemyD1("analytics-db", {
  name: `effectful-analytics-${stage}`,
});

/**
 * R2 Bucket for content storage
 * Stores uploaded files and objects
 */
const contentBucket = await R2Bucket("content-storage", {
  name: `effectful-content-${stage}`,
});

/**
 * Queue for background tasks
 * Processes async tasks (process, analyze, cleanup)
 */
const tasksQueue = await AlchemyQueue("tasks-queue", {
  name: `effectful-tasks-${stage}`,
});

// ── 3. Define Worker ───────────────────────────────────────────────────────

const workerProps = {
  name: `effectful-example-${stage}`,
  entrypoint: "./src/index.ts",
  compatibility: "node" as const,
  bindings: {
    CACHE_KV: cacheKv,
    ANALYTICS_DB: analyticsDb,
    CONTENT_STORAGE: contentBucket,
    TASKS_QUEUE: tasksQueue,
  },
  dev: {
    port: 8787,
  },
  observability: {
    traces: {
      enabled: true,
      headSamplingRate: stage === "production" ? 0.1 : 1.0,
    },
    logs: {
      enabled: true,
      headSamplingRate: 1.0,
    },
  },
  // Production: add custom domains. Development: uses *.workers.dev
  ...(stage === "production" && {
    routes: [{ pattern: "example.effectful-cloudflare.com/*" }],
  }),
};

const worker = await Worker("example-worker", workerProps);

// ── 4. Finalize Deployment ─────────────────────────────────────────────────

await app.finalize();

// ── 5. Export for Type Inference ───────────────────────────────────────────

/**
 * Export worker for type-safe binding inference.
 *
 * In a real project, you would import this in a global env.d.ts:
 *
 * ```ts
 * import { worker } from "./alchemy.run"
 * export type CloudflareEnv = typeof worker.Env
 * ```
 */
export { worker };
