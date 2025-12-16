import type { CacheAdapter, CachePutOptions } from "./cache_adapter";

export class KvCacheAdapter implements CacheAdapter {
	constructor(private readonly kv: KVNamespace) {}

	async get(key: string): Promise<string | null> {
		try {
			return await this.kv.get(key);
		} catch {
			return null;
		}
	}

	async put(
		key: string,
		value: string,
		options?: CachePutOptions,
	): Promise<void> {
		try {
			const ttlSeconds = options?.ttlSeconds;
			await this.kv.put(
				key,
				value,
				ttlSeconds != null ? { expirationTtl: ttlSeconds } : undefined,
			);
		} catch {
			// ignore KV write failures
		}
	}
}
