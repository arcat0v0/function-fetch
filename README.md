```txt
pnpm install
pnpm run dev
```

```txt
pnpm run deploy
```

## Proxy 配置（环境变量）

- `FETCH_TARGETS`：多个目标基址（负载均衡），支持两种格式：
  - JSON 数组：`["https://a.com","https://b.com/api"]`
  - 逗号/空格/换行分隔：`https://a.com, https://b.com/api`
- 如果数组里只有一个网址，则等价于不需要负载均衡
- 转发规则：保留原始 `path + query`，并追加到目标基址的 path 上（例如目标 `https://b.com/api` + 请求 `/v1/ping` => `https://b.com/api/v1/ping`）
- `FETCH_HEALTH_PATH`：健康检查 path（只用于 Worker 自己探测最快目标），默认 `/`
- `FETCH_HEALTH_TIMEOUT_MS`：健康检查超时（毫秒），默认 `1500`
- `FETCH_RETRY_ON_5XX`：对 `GET/HEAD/OPTIONS` 是否在 5xx 时切换其它目标重试，默认 `true`
- `FETCH_CACHE_ADAPTER`：选择用于缓存“最快目标”的缓存适配器，默认 `auto`（`memory,kv`）；可选值示例：`kv` / `memory` / `memory,kv` / `none`

### 缓存最快目标（可选）

绑定一个 KV Namespace 到 `FASTEST_KV` 后，Worker 会把探测到的最快目标缓存起来：

- `FETCH_CACHE_KEY`：缓存 key，默认 `proxy:fastest`
- `FETCH_CACHE_TTL_SECONDS`：缓存 TTL（秒），默认 `300`（最小 10）

## Cloudflare Workers / Wrangler 示例

`wrangler.jsonc`：

```jsonc
{
  "vars": {
    "FETCH_TARGETS": "[\"https://a.com\",\"https://b.com/api\"]",
    "FETCH_HEALTH_PATH": "/healthz",
    "FETCH_CACHE_TTL_SECONDS": "300"
  },
  "kv_namespaces": [
    { "binding": "FASTEST_KV", "id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
  ]
}
```

## 类型生成

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
pnpm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```
