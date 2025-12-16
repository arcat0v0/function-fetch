import type { ProxyBindings } from "./proxy.js";
import { proxyFetch } from "./proxy.js";
import { CacheManager } from "./adapter/cache_manager.js";
import { MemoryCacheAdapter } from "./adapter/memory_adapter.js";
import { EsaKvAdapter } from "./adapter/esa_kv_adapter.js";
import { ESA_BUILD_ENV } from "./esa_build_env.generated.js";
import type { CacheAdapter } from "./adapter/cache_adapter.js";

const memoryCache = new MemoryCacheAdapter();

const worker = {
	async fetch(request: Request, env: ProxyBindings) {
		const mergedEnv = {
			...(ESA_BUILD_ENV as ProxyBindings),
			...(env ?? {}),
		};

		const adapters: CacheAdapter[] = [memoryCache];

		// Check for ESA KV Namespace
		// Use type assertion to access potential custom env var
		const kvNamespace = (mergedEnv as unknown as Record<string, string>)
			.ESA_KV_NAMESPACE;

		if (kvNamespace && typeof kvNamespace === "string") {
			adapters.push(new EsaKvAdapter(kvNamespace));
		}

		// Inject the cache manager
		mergedEnv.__CACHE_MANAGER__ = new CacheManager(adapters);

		return proxyFetch(request, mergedEnv);
	},
};

export default worker;