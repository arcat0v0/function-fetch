# Function Fetch - 智能边缘反向代理

这是一个高性能的智能反向代理，专为 Serverless 边缘环境（Cloudflare Workers, 阿里云 ESA）和 Node.js 环境设计。它能够自动探测并路由到响应最快的目标服务器，提供故障转移（Failover）和多级缓存支持。

[English Documentation](../README.md)

## ✨ 特性

- **智能路由**：自动探测后端目标列表的延迟，将流量转发到响应最快的节点。
- **故障转移**：当主节点返回 5xx 错误时，自动重试次优节点。
- **多级缓存**：
  - **L1 内存缓存**：实例级别的热点缓存。
  - **L2 持久化缓存**：支持 Cloudflare KV 和 Alibaba Cloud ESA EdgeKV。
- **多平台支持**：
  - **Cloudflare Workers**：原生支持，通过 `wrangler` 部署。
  - **Alibaba Cloud ESA**：支持边缘程序（Edge Routine）及 EdgeKV。
  - **Node.js**：提供适配器，可集成到 Express/HTTP Server 或 Docker 部署。

## 🛠️ 配置说明

所有配置均通过环境变量进行管理：

| 变量名 | 说明 | 默认值 | 示例 |
| :--- | :--- | :--- | :--- |
| `FETCH_TARGETS` | **(必填)** 目标服务器列表。支持 JSON 数组或逗号/空格分隔的字符串。 | - | `["https://us.example.com", "https://eu.example.com"]` |
| `FETCH_HEALTH_PATH` | 用于健康检查的路径。系统会请求 `Target + HealthPath` 来计算延迟。 | `/` | `/ping` |
| `FETCH_HEALTH_TIMEOUT_MS` | 健康检查超时时间（毫秒）。 | `1500` | `2000` |
| `FETCH_RETRY_ON_5XX` | 遇到 5xx 错误时是否重试其他节点。 | `true` | `false` |
| `FETCH_CACHE_ADAPTER` | 缓存策略。可选：`memory`, `kv`, `auto`, `none`。`auto` 会同时使用内存和 KV。 | `auto` | `memory,kv` |
| `FETCH_CACHE_KEY` | 存储最快节点信息的缓存 Key。 | `proxy:fastest` | `my-app:best-node` |
| `FETCH_CACHE_TTL_SECONDS` | 最快节点信息的缓存有效期（秒）。 | `300` | `60` |
| `FETCH_CACHE_KV_BINDING` | **(Cloudflare)** KV 绑定的变量名。 | `FASTEST_KV` | `MY_KV` |
| `ESA_KV_NAMESPACE` | **(Alibaba Cloud ESA)** EdgeKV 的 Namespace ID。 | - | `1234567890` |

## 🚀 部署指南

### 1. Cloudflare Workers

1.  安装依赖：
    ```bash
    pnpm install
    ```
2.  配置 `wrangler.jsonc`：
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
3.  部署：
    ```bash
    pnpm run deploy
    ```

### 2. Alibaba Cloud ESA (阿里云边缘安全加速)

阿里云 ESA 环境通过 Edge Routine 运行，需使用专门的构建脚本。

1.  **构建代码**：
    该命令会生成适用于 ESA 的单文件产物 `dist-node/esa.js`（或其他指定输出）。
    *注意：ESA 环境变量建议在控制台配置，但部分静态配置也会被打包。*
    ```bash
    # 1. 生成环境配置文件的占位符 (或注入构建时变量)
    pnpm run gen:esa-env

    # 2. 打包代码
    npx esbuild src/esa.ts --bundle --outfile=dist/esa.js --format=esm --target=esnext
    ```
    *(更推荐使用项目中配置好的 `npm run build:node` 或类似命令，如果适用)*

2.  **配置 EdgeKV**：
    在阿里云 ESA 控制台创建 EdgeKV Namespace，并记录 Namespace ID。

3.  **上传代码**：
    将构建好的 `dist/esa.js` 代码复制到 ESA 控制台的 Edge Routine 代码编辑器中。

4.  **设置环境变量**（在 ESA 控制台）：
    - `FETCH_TARGETS`: `https://origin1.com,https://origin2.com`
    - `ESA_KV_NAMESPACE`: `你的NamespaceID` (用于持久化缓存)

### 3. Node.js

可作为独立服务运行，或集成到现有应用中。

**独立运行：**

1.  构建：
    ```bash
    pnpm run build:node
    ```
2.  运行（需设置环境变量）：
    ```bash
    export FETCH_TARGETS="https://a.com, https://b.com"
    node dist-node/node_server.js
    ```

**代码集成：**

```typescript
import http from "node:http";
import { createNodeHandler } from "./src/node";

const handler = createNodeHandler({
  env: {
    FETCH_TARGETS: "https://api.example.com",
    FETCH_HEALTH_PATH: "/status"
  }
});

http.createServer((req, res) => {
  handler(req, res);
}).listen(3000);
```

## 📦 开发

```bash
# 本地开发 (Cloudflare 环境模拟)

pnpm run dev

# 类型检查
pnpm run cf-typegen
```
