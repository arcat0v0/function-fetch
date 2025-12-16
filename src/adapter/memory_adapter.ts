import type { CacheAdapter, CachePutOptions } from "./cache_adapter";

type CachedEntry = {
	value: string;
	expiresAtMs: number;
};

export class MemoryCacheAdapter implements CacheAdapter {
	private readonly cache = new Map<string, CachedEntry>();

	async get(key: string): Promise<string | null> {
		const entry = this.cache.get(key);
		if (!entry) return null;
		if (Date.now() >= entry.expiresAtMs) {
			this.cache.delete(key);
			return null;
		}
		return entry.value;
	}

	async put(
		key: string,
		value: string,
		options?: CachePutOptions,
	): Promise<void> {
		const ttlSeconds = options?.ttlSeconds ?? 0;
		if (ttlSeconds <= 0) {
			this.cache.delete(key);
			return;
		}

		this.cache.set(key, {
			value,
			expiresAtMs: Date.now() + ttlSeconds * 1000,
		});
	}
}
