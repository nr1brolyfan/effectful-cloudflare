# effectful-cloudflare Alchemy IaC Example

Infrastructure as Code example using **Alchemy SDK** to deploy a Cloudflare Worker with multiple bindings (KV, D1, R2, Queue).

## Features

- 🏗️ **Infrastructure as Code** with Alchemy
- 🔒 **Type-safe bindings** auto-inferred from `alchemy.run.ts`
- 📦 **Multiple services**: KV, D1, R2, Queue
- 🎯 **Effect v4** for safe, composable effects
- 🔄 **Stage-based deployment** (development, staging, production)
- 📊 **Built-in observability** (traces, logs)

## Project Structure

```
examples/alchemy-iac/
├── alchemy.run.ts    # Infrastructure definition (IaC)
├── src/
│   └── index.ts      # Worker entrypoint with Effect
├── package.json      # Dependencies and scripts
├── tsconfig.json     # TypeScript configuration
└── README.md         # This file
```

## Prerequisites

1. **Cloudflare account** with API token
2. **Alchemy CLI** installed: `npm install -g alchemy`
3. **Bun** or **Node.js** 20+

## Setup

### 1. Install Dependencies

```bash
bun install
# or
npm install
```

### 2. Configure Alchemy

```bash
# Set up Cloudflare credentials
alchemy configure

# Or set environment variables
export CLOUDFLARE_API_TOKEN=your-api-token
export CLOUDFLARE_ACCOUNT_ID=your-account-id
```

### 3. Set Environment Variables

Create a `.env` file:

```env
# Alchemy
ALCHEMY_PASSWORD=your-encryption-passphrase
STAGE=development
```

## Development

### Local Development

```bash
bun run dev
```

This starts Miniflare emulation with all bindings (KV, D1, R2, Queue).

### Deploy to Development

```bash
bun run deploy
```

Creates resources with `effectful-*-development` naming.

### Deploy to Staging

```bash
bun run deploy:staging
```

Creates resources with `effectful-*-staging` naming.

### Deploy to Production

```bash
bun run deploy:production
```

Creates resources with `effectful-*-production` naming and adds custom routes.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API overview |
| `/cache/:key` | GET | Get cached value |
| `/cache` | POST | Set cache value |
| `/analytics` | GET | Get analytics summary |
| `/analytics` | POST | Record analytics event |
| `/files` | GET | List R2 files |
| `/files` | POST | Upload file to R2 |
| `/tasks` | POST | Queue background task |

## Infrastructure

### Resources Defined in `alchemy.run.ts`

```typescript
// KV Namespace for caching
const cacheKv = await AlchemyKV("cache-kv", {
  title: `effectful-cache-${stage}`,
})

// D1 Database for analytics
const analyticsDb = await AlchemyD1("analytics-db", {
  name: `effectful-analytics-${stage}`,
})

// R2 Bucket for content storage
const contentBucket = await R2Bucket("content-storage", {
  name: `effectful-content-${stage}`,
})

// Queue for background tasks
const tasksQueue = await AlchemyQueue("tasks-queue", {
  name: `effectful-tasks-${stage}`,
})

// Worker with all bindings
const worker = await Worker("example-worker", {
  name: `effectful-example-${stage}`,
  entrypoint: "./src/index.ts",
  bindings: {
    CACHE_KV: cacheKv,
    ANALYTICS_DB: analyticsDb,
    CONTENT_STORAGE: contentBucket,
    TASKS_QUEUE: tasksQueue,
  },
})
```

### Type-Safe Bindings

Binding types are automatically inferred from `alchemy.run.ts`:

```typescript
// Export worker for type inference
export { worker }

// In env.d.ts (real project):
import { worker } from "./alchemy.run"
export type CloudflareEnv = typeof worker.Env
```

No manual type declarations or code generation needed!

## Example Requests

### Cache

```bash
# Set cache value
curl -X POST http://localhost:8787/cache \
  -H "Content-Type: application/json" \
  -d '{"key":"greeting","value":"Hello World","ttl":60}'

# Get cache value
curl http://localhost:8787/cache/greeting
```

### Analytics

```bash
# Record event
curl -X POST http://localhost:8787/analytics \
  -H "Content-Type: application/json" \
  -d '{"event":"page_view","metadata":{"page":"/home"}}'

# Get summary
curl http://localhost:8787/analytics
```

### R2 Files

```bash
# Upload file
curl -X POST http://localhost:8787/files \
  -H "Content-Type: application/json" \
  -d '{"key":"test.txt","content":"Hello R2!"}'

# List files
curl http://localhost:8787/files
```

### Queue Tasks

```bash
# Queue a task
curl -X POST http://localhost:8787/tasks \
  -H "Content-Type: application/json" \
  -d '{"type":"process","data":{"id":"123"}}'
```

## Deployment Workflow

### Blue-Green Deployment

```bash
# 1. Deploy to staging
bun run deploy:staging

# 2. Test staging
curl https://effectful-example-staging.workers.dev/

# 3. Deploy to production
bun run deploy:production
```

### Rollback

```bash
# Destroy staging (cleanup)
bun run destroy:staging

# Or destroy production (emergency)
bun run destroy:production
```

## State Management

Alchemy stores state in `.alchemy/{stage}/*.json` files (gitignored).

Each resource has its own state file tracking:
- Resource ID
- Configuration
- Encrypted secrets

### Remote State (CI/CD)

For CI/CD, use a remote state store:

```typescript
import { CloudflareStateStore } from "alchemy/state"

const app = await alchemy("effectful-cloudflare-example", {
  stateStore: process.env.CI
    ? (scope) => new CloudflareStateStore(scope, {
        stateToken: alchemy.secret(process.env.ALCHEMY_STATE_TOKEN),
      })
    : undefined,
})
```

## Observability

The worker includes built-in observability:

```typescript
observability: {
  traces: {
    enabled: true,
    headSamplingRate: stage === "production" ? 0.1 : 1.0,
  },
  logs: {
    enabled: true,
    headSamplingRate: 1.0,
  },
}
```

View logs in Cloudflare Dashboard or via `wrangler tail`:

```bash
wrangler tail effectful-example-development
```

## Learn More

- **Alchemy Documentation**: https://alchemy.run
- **effectful-cloudflare**: https://github.com/yourusername/effectful-cloudflare
- **Effect Documentation**: https://effect.website
- **Cloudflare Workers**: https://developers.cloudflare.com/workers/

## License

MIT
