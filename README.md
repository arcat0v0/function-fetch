```txt
npm install
npm run dev
```

```txt
npm run deploy
```

## Proxy 配置（环境变量）

- `PROXY_TARGET`：单个目标基址，例如 `https://example.com`
- `PROXY_TARGETS`：多个目标基址（负载均衡），支持两种格式：
  - JSON 数组：`["https://a.com","https://b.com/api"]`
  - 逗号/空格/换行分隔：`https://a.com, https://b.com/api`
- 转发规则：保留原始 `path + query`，并追加到目标基址的 path 上（例如目标 `https://b.com/api` + 请求 `/v1/ping` => `https://b.com/api/v1/ping`）
- `PROXY_HEALTH_PATH`：健康检查 path（只用于 Worker 自己探测最快目标），默认 `/`
- `PROXY_HEALTH_TIMEOUT_MS`：健康检查超时（毫秒），默认 `1500`
- `PROXY_RETRY_ON_5XX`：对 `GET/HEAD/OPTIONS` 是否在 5xx 时切换其它目标重试，默认 `true`

### KV 缓存最快目标（可选）

绑定一个 KV Namespace 到 `FASTEST_KV` 后，Worker 会把探测到的最快目标缓存起来：

- `PROXY_KV_KEY`：KV key，默认 `proxy:fastest`
- `PROXY_KV_TTL_SECONDS`：缓存 TTL（秒），默认 `300`（最小 10）

## Cloudflare Workers / Wrangler 示例

`wrangler.jsonc`：

```jsonc
{
  "vars": {
    "PROXY_TARGETS": "[\"https://a.com\",\"https://b.com/api\"]",
    "PROXY_HEALTH_PATH": "/healthz",
    "PROXY_KV_TTL_SECONDS": "300"
  },
  "kv_namespaces": [
    { "binding": "FASTEST_KV", "id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
  ]
}
```

## 类型生成

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```
