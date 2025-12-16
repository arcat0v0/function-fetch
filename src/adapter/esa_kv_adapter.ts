import type { CacheAdapter, CachePutOptions } from "./cache_adapter.js";

// Define the ESA EdgeKV interface locally as it's not available in standard types
interface EdgeKvOptions {
	namespace: string;
}

interface EdgeKvGetOptions {
	type: "text" | "json" | "arrayBuffer" | "stream";
}

interface EdgeKvPutOptions {
	expiration?: number;
	expirationTtl?: number;
}

declare class EdgeKV {
	constructor(options: EdgeKvOptions);
	get(
		key: string,
		options?: EdgeKvGetOptions,
	): Promise<string | ArrayBuffer | ReadableStream | null>;
	put(
		key: string,
		value: string | ArrayBuffer | ReadableStream,
		options?: EdgeKvPutOptions,
	): Promise<void>;
	delete(key: string): Promise<void>;
}

export class EsaKvAdapter implements CacheAdapter {
	private kv: EdgeKV;

	constructor(namespace: string) {
		// @ts-ignore - EdgeKV is a global in ESA environment
		this.kv = new EdgeKV({ namespace });
	}

	async get(key: string): Promise<string | null> {
		try {
			const result = await this.kv.get(key, { type: "text" });
			return typeof result === "string" ? result : null;
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
			const kvOptions: EdgeKvPutOptions | undefined = options?.ttlSeconds
				? { expirationTtl: options.ttlSeconds }
				: undefined;
			await this.kv.put(key, value, kvOptions);
		} catch (e) {
			// ignore KV write failures
		}
	}
}
