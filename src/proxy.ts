import type { CacheAdapter } from "./adapter/cache_adapter";
import { CacheManager } from "./adapter/cache_manager";
import { KvCacheAdapter } from "./adapter/kv_adapter";
import { MemoryCacheAdapter } from "./adapter/memory_adapter";

export type ProxyBindings = {
	FETCH_TARGETS?: string;
	FETCH_HEALTH_PATH?: string;
	FETCH_HEALTH_TIMEOUT_MS?: string;
	FETCH_CACHE_ADAPTER?: string;
	FETCH_CACHE_KEY?: string;
	FETCH_CACHE_TTL_SECONDS?: string;
	FETCH_RETRY_ON_5XX?: string;
	FETCH_CACHE_KV_BINDING?: string;
	FASTEST_KV?: KVNamespace;
};

type Target = {
	baseUrl: URL;
	basePath: string;
	normalized: string;
};

const memoryCache = new MemoryCacheAdapter();

function parseBoolean(
	value: string | undefined,
	defaultValue: boolean,
): boolean {
	if (value == null) return defaultValue;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
	return defaultValue;
}

function parseIntOr(value: string | undefined, defaultValue: number): number {
	if (value == null) return defaultValue;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : defaultValue;
}

function ensureLeadingSlash(pathname: string): string {
	if (!pathname) return "/";
	return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function normalizeBasePath(pathname: string): string {
	const withSlash = ensureLeadingSlash(pathname);
	const trimmed = withSlash.replace(/\/+$/, "");
	return trimmed === "" ? "/" : trimmed;
}

function joinPaths(basePath: string, requestPath: string): string {
	const normalizedBase = normalizeBasePath(basePath);
	const normalizedReq = ensureLeadingSlash(requestPath);
	if (normalizedBase === "/") return normalizedReq;
	return `${normalizedBase}/${normalizedReq.replace(/^\/+/, "")}`;
}

function parseTargetsFromEnv(env: ProxyBindings): Target[] {
	const raw = env.FETCH_TARGETS?.trim();
	if (!raw) return [];

	let items: string[] = [];
	if (raw.startsWith("[")) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) items = parsed.map(String);
		} catch {
			items = [];
		}
	} else {
		items = raw
			.split(/[,\n\r\t ]+/g)
			.map((s) => s.trim())
			.filter(Boolean);
	}

	const targets: Target[] = [];
	for (const item of items) {
		try {
			const url = new URL(item);
			const basePath = normalizeBasePath(url.pathname);
			url.pathname = basePath === "/" ? "/" : `${basePath}/`;
			url.search = "";
			url.hash = "";
			targets.push({
				baseUrl: url,
				basePath,
				normalized: url.toString().replace(/\/+$/, "/"),
			});
		} catch {
			// ignore invalid URL entries
		}
	}

	const unique = new Map<string, Target>();
	for (const t of targets) unique.set(t.normalized, t);
	return [...unique.values()];
}

function shouldRetryOn5xx(env: ProxyBindings): boolean {
	return parseBoolean(env.FETCH_RETRY_ON_5XX, true);
}

function cacheKey(env: ProxyBindings): string {
	return (env.FETCH_CACHE_KEY?.trim() || "proxy:fastest").slice(0, 512);
}

function cacheTtlSeconds(env: ProxyBindings): number {
	return Math.max(10, parseIntOr(env.FETCH_CACHE_TTL_SECONDS, 300));
}

type CacheAdapterKind = "memory" | "kv" | "none";

function parseCacheAdapterKinds(env: ProxyBindings): CacheAdapterKind[] {
	const raw = env.FETCH_CACHE_ADAPTER?.trim();
	if (!raw || raw.toLowerCase() === "auto") return ["memory", "kv"];

	let items: string[] = [];
	if (raw.startsWith("[")) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) items = parsed.map(String);
		} catch {
			items = [];
		}
	} else {
		items = raw
			.split(/[,\s]+/g)
			.map((s) => s.trim())
			.filter(Boolean);
	}
	items = items.map((s) => s.replace(/^['"]|['"]$/g, "").toLowerCase());

	const kinds: CacheAdapterKind[] = [];
	for (const item of items) {
		const kind =
			item === "memory" || item === "mem" || item === "inmemory"
				? "memory"
			: item === "kv" || item === "cloudflare_kv"
				? "kv"
			: item === "none" || item === "off" || item === "disabled"
				? "none"
				: null;
		if (!kind) continue;
		if (!kinds.includes(kind)) kinds.push(kind);
	}

	return kinds.length ? kinds : ["memory", "kv"];
}

function normalizeCachedTarget(value: string): string | null {
	try {
		return new URL(value).toString().replace(/\/+$/, "/");
	} catch {
		return null;
	}
}

function healthPath(env: ProxyBindings): string {
	return ensureLeadingSlash(env.FETCH_HEALTH_PATH?.trim() || "/");
}

function healthTimeoutMs(env: ProxyBindings): number {
	return Math.max(200, parseIntOr(env.FETCH_HEALTH_TIMEOUT_MS, 1500));
}

async function probeTargets(
	targets: Target[],
	env: ProxyBindings,
): Promise<Target | null> {
	const path = healthPath(env);
	const timeoutMs = healthTimeoutMs(env);

	const results = await Promise.allSettled(
		targets.map(async (target) => {
			const started = performance.now();
			const url = new URL(target.baseUrl.toString());
			url.pathname = joinPaths(target.basePath, path);
			url.search = "";
			url.hash = "";

			const response = await fetch(url.toString(), {
				method: "GET",
				redirect: "manual",
				cache: "no-store",
				signal: AbortSignal.timeout(timeoutMs),
			});

			const ms = performance.now() - started;
			const healthy = response.status >= 200 && response.status < 500;
			return { target, healthy, ms };
		}),
	);

	const healthy = results
		.flatMap((r) =>
			r.status === "fulfilled" && r.value.healthy ? [r.value] : [],
		)
		.sort((a, b) => a.ms - b.ms);

	return healthy[0]?.target ?? null;
}

function buildCacheManager(env: ProxyBindings): CacheManager | null {
	const kinds = parseCacheAdapterKinds(env);

	if (kinds.includes("none")) return null;

	const adapters: CacheAdapter[] = [];
	for (const kind of kinds) {
		if (kind === "memory") {
			adapters.push(memoryCache);
			continue;
		}
		if (kind === "kv") {
			const kv = getKvNamespace(env);
			if (kv) adapters.push(new KvCacheAdapter(kv));
		}
	}

	if (adapters.length === 0) return null;

	return new CacheManager(adapters);
}

function buildUpstreamUrl(target: Target, original: URL): URL {
	const upstream = new URL(target.baseUrl.toString());
	upstream.pathname = joinPaths(target.basePath, original.pathname);
	upstream.search = original.search;
	upstream.hash = "";
	return upstream;
}

function getKvNamespace(env: ProxyBindings): KVNamespace | null {
	const bindingName = env.FETCH_CACHE_KV_BINDING?.trim() || "FASTEST_KV";
	if (!bindingName) return null;
	const candidate = (env as Record<string, unknown>)[bindingName];
	if (!candidate || typeof candidate !== "object") return null;
	if (typeof (candidate as KVNamespace).get !== "function") return null;
	return candidate as KVNamespace;
}

function cloneHeadersForUpstream(request: Request): Headers {
	const headers = new Headers(request.headers);
	headers.delete("host");
	return headers;
}

async function fetchViaTarget(
	target: Target,
	request: Request,
): Promise<Response> {
	const originalUrl = new URL(request.url);
	const upstreamUrl = buildUpstreamUrl(target, originalUrl);
	const headers = cloneHeadersForUpstream(request);

	return fetch(
		new Request(upstreamUrl.toString(), {
			method: request.method,
			headers,
			body: request.body,
			redirect: "manual",
		}),
	);
}

export async function proxyFetch(
	request: Request,
	env: ProxyBindings,
): Promise<Response> {
	const targets = parseTargetsFromEnv(env);
	if (targets.length === 0) {
		return new Response("Missing env: FETCH_TARGETS", {
			status: 500,
		});
	}

	const retryable = ["GET", "HEAD", "OPTIONS"].includes(
		request.method.toUpperCase(),
	);
	const retryOn5xx = retryable && shouldRetryOn5xx(env);

	let cache = buildCacheManager(env);
	const key = cache ? cacheKey(env) : null;
	const ttlSeconds = cache ? cacheTtlSeconds(env) : 0;

	let cachedNormalized: string | null = null;
	if (cache && key) {
		try {
			const cached = await cache.get(key, { ttlSeconds });
			cachedNormalized = cached ? normalizeCachedTarget(cached) : null;
		} catch {
			cache = null;
			cachedNormalized = null;
		}
	}

	let primary: Target | null = null;
	if (cache && key) {
		primary = cachedNormalized
			? targets.find((t) => t.normalized === cachedNormalized) ?? null
			: null;

		if (!primary) {
			primary = (await probeTargets(targets, env)) ?? targets[0] ?? null;
			if (!primary) {
				return new Response("No proxy targets available", { status: 500 });
			}
			void cache.put(key, primary.normalized, { ttlSeconds }).catch(() => {
				cache = null;
			});
		}
	} else {
		primary = targets[0] ?? null;
		if (!primary) {
			return new Response("No proxy targets available", { status: 500 });
		}
	}

	const ordered = [
		primary,
		...targets.filter((t) => t.normalized !== primary.normalized),
	];
	const maxAttempts = retryable ? Math.min(ordered.length, 3) : 1;

	let lastError: unknown = null;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const target = ordered[attempt];
		if (!target) break;
		try {
			const response = await fetchViaTarget(target, request);
			if (retryOn5xx && response.status >= 500 && attempt + 1 < maxAttempts) {
				response.body?.cancel();
				continue;
			}
			if (attempt === 0 && response.ok && cache && key) {
				void cache.put(key, target.normalized, { ttlSeconds }).catch(() => {
					cache = null;
				});
			}
			return response;
		} catch (err) {
			lastError = err;
			if (attempt + 1 >= maxAttempts) break;
		}
	}

	const message =
		lastError instanceof Error ? lastError.message : "Upstream fetch failed";
	return new Response(message, { status: 502 });
}
