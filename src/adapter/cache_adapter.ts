export type CachePutOptions = {
	ttlSeconds?: number;
};

export interface CacheAdapter {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: CachePutOptions): Promise<void>;
}
