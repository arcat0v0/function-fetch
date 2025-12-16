# Function Fetch - Smart Edge Reverse Proxy

A high-performance, smart reverse proxy designed for Serverless Edge environments (Cloudflare Workers, Alibaba Cloud ESA) and Node.js. It automatically detects and routes traffic to the fastest backend target, providing failover and multi-level caching.

[中文文档 (Chinese Documentation)](docs/README_zh-CN.md)

## ✨ Features

- **Smart Routing**: Automatically probes latency of backend targets and routes traffic to the fastest one.
- **Failover**: Automatically retries the next best target when the primary node returns a 5xx error.
- **Multi-Level Caching**:
  - **L1 Memory Cache**: Instance-level hot cache.
  - **L2 Persistent Cache**: Supports Cloudflare KV and Alibaba Cloud ESA EdgeKV.
- **Multi-Platform**:
  - **Cloudflare Workers**: Native support via `wrangler`.
  - **Alibaba Cloud ESA**: Supports Edge Routine and EdgeKV.
  - **Node.js**: Adapter provided for integration with Express/HTTP Server or Docker.

## 🛠️ Configuration

All configuration is managed via environment variables:

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `FETCH_TARGETS` | **(Required)** List of target servers. JSON array or comma/space separated. | - | `["https://us.ex.com", "https://eu.ex.com"]` |
| `FETCH_HEALTH_PATH` | Path used for health checks. Latency is calculated by requesting `Target + HealthPath`. | `/` | `/ping` |
| `FETCH_HEALTH_TIMEOUT_MS` | Timeout for health checks (ms). | `1500` | `2000` |
| `FETCH_RETRY_ON_5XX` | Whether to retry other nodes on 5xx errors. | `true` | `false` |
| `FETCH_CACHE_ADAPTER` | Cache strategy: `memory`, `kv`, `auto`, `none`. | `auto` | `memory,kv` |
| `FETCH_CACHE_KEY` | Cache key for storing the fastest node info. | `proxy:fastest` | `my-app:best` |
| `FETCH_CACHE_TTL_SECONDS` | TTL for the fastest node cache (seconds). | `300` | `60` |
| `FETCH_CACHE_KV_BINDING` | **(Cloudflare)** KV binding name. | `FASTEST_KV` | `MY_KV` |
| `ESA_KV_NAMESPACE` | **(Alibaba Cloud ESA)** EdgeKV Namespace ID. | - | `1234567890` |

## 🚀 Deployment

### 1. Cloudflare Workers

1.  Install dependencies:
    ```bash
    pnpm install
    ```
2.  Configure `wrangler.jsonc`:
    ```jsonc
    {
      "name": "my-proxy",
      "main": "src/index.ts",
      "compatibility_date": "2024-04-01",
      "vars": {
        "FETCH_TARGETS": "[\"https://api-us.server.com\", \"https://api-eu.server.com\"]",
        "FETCH_HEALTH_PATH": "/health"
      },
      "kv_namespaces": [
        { "binding": "FASTEST_KV", "id": "<YOUR_KV_ID>" }
      ]
    }
    ```
3.  Deploy:
    ```bash
    pnpm run deploy
    ```

### 2. Alibaba Cloud ESA (Edge Security Acceleration)

For ESA Edge Routine, you need to bundle the code.

1.  **Bundle Code**:
    You can use `esbuild` to create a single-file bundle from `src/esa.ts`.
    ```bash
    # 1. Generate environment config file
    pnpm run gen:esa-env

    # 2. Bundle the code
    npx esbuild src/esa.ts --bundle --outfile=dist/esa.js --format=esm --target=esnext
    ```
    *Note: `src/esa.ts` is the dedicated entry point for ESA.*

2.  **Configure EdgeKV**:
    Create an EdgeKV Namespace in the Alibaba Cloud ESA console and note the Namespace ID.

3.  **Upload**:
    Copy the content of `dist/esa.js` to the Edge Routine code editor in the ESA console.

4.  **Set Environment Variables** (in ESA Console):
    - `FETCH_TARGETS`: `https://origin1.com,https://origin2.com`
    - `ESA_KV_NAMESPACE`: `<Your_Namespace_ID>` (Required for persistent caching)

### 3. Node.js

Run as a standalone service or integrate into an existing app.

**Standalone:**

1.  Build:
    ```bash
    pnpm run build:node
    ```
2.  Run:
    ```bash
    export FETCH_TARGETS="https://a.com, https://b.com"
    node dist-node/node_server.js
    ```

**Integration:**

```typescript
import http from "node:http";
import { createNodeHandler } from "./src/node";

const handler = createNodeHandler({
  env: {
    FETCH_TARGETS: "https://api.example.com"
  }
});

http.createServer((req, res) => {
  handler(req, res);
}).listen(3000);
```

## 📦 Development

```bash
# Local development (Cloudflare simulation)
pnpm run dev

# Type generation
pnpm run cf-typegen
```