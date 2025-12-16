import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const OUTPUT = new URL("../src/esa_build_env.generated.ts", import.meta.url);

// 仅把代理需要的配置固化进构建产物，避免把所有 process.env（含敏感信息）打包进去。
const ALLOW_KEYS = [
	"FETCH_TARGETS",
	"FETCH_HEALTH_PATH",
	"FETCH_HEALTH_TIMEOUT_MS",
	"FETCH_CACHE_ADAPTER",
	"FETCH_CACHE_KEY",
	"FETCH_CACHE_TTL_SECONDS",
	"FETCH_RETRY_ON_5XX",
	"FETCH_CACHE_KV_BINDING",
	"ESA_KV_NAMESPACE",
];

/** @type {Record<string, string>} */
const picked = {};
for (const key of ALLOW_KEYS) {
	const v = process.env[key];
	if (typeof v === "string" && v.length) picked[key] = v;
}

const content = `// This file is generated at build time by scripts/gen-esa-env.mjs\n// Do not edit manually.\nimport type { ProxyBindings } from \"./proxy.js\";\n\nexport const ESA_BUILD_ENV: Partial<ProxyBindings> = ${JSON.stringify(picked, null, 2)};\n`;

await mkdir(dirname(OUTPUT.pathname), { recursive: true });
await writeFile(OUTPUT, content, "utf8");
