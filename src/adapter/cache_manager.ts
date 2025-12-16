import type { CacheAdapter, CachePutOptions } from "./cache_adapter.js";

export class CacheManager {
	constructor(private readonly adapters: CacheAdapter[]) {}

	async get(
		key: string,
		backfillOptions?: CachePutOptions,
	): Promise<string | null> {
		for (let i = 0; i < this.adapters.length; i++) {
			const adapter = this.adapters[i];
			if (!adapter) continue;

			let value: string | null = null;
			try {
				value = await adapter.get(key);
			} catch {
				value = null;
			}

			if (value == null) continue;

			const backfill = this.adapters.slice(0, i);
			await Promise.all(
				backfill.map(async (a) => {
					try {
						await a.put(key, value, backfillOptions);
					} catch {
						// ignore backfill failures
					}
				}),
			);

			return value;
		}

		return null;
	}

	async put(
		key: string,
		value: string,
		options?: CachePutOptions,
	): Promise<void> {
		await Promise.all(
			this.adapters.map(async (adapter) => {
				try {
					await adapter.put(key, value, options);
				} catch {
					// ignore cache write failures
				}
			}),
		);
	}
}
