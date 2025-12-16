export type ProxyBindings = {
	PROXY_TARGET?: string;
	PROXY_TARGETS?: string;
	PROXY_HEALTH_PATH?: string;
	PROXY_HEALTH_TIMEOUT_MS?: string;
	PROXY_KV_KEY?: string;
	PROXY_KV_TTL_SECONDS?: string;
	PROXY_RETRY_ON_5XX?: string;
	FASTEST_KV?: KVNamespace;
};

type Target = {
	baseUrl: URL;
	basePath: string;
	normalized: string;
};

type CachedFastest = {
	normalized: string;
	expiresAtMs: number;
};

let inMemoryFastest: CachedFastest | null = null;

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
	const raw = env.PROXY_TARGETS?.trim() || env.PROXY_TARGET?.trim();
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
	return parseBoolean(env.PROXY_RETRY_ON_5XX, true);
}

function kvKey(env: ProxyBindings): string {
	return (env.PROXY_KV_KEY?.trim() || "proxy:fastest").slice(0, 512);
}

function kvTtlSeconds(env: ProxyBindings): number {
	return Math.max(10, parseIntOr(env.PROXY_KV_TTL_SECONDS, 300));
}

function healthPath(env: ProxyBindings): string {
	return ensureLeadingSlash(env.PROXY_HEALTH_PATH?.trim() || "/");
}

function healthTimeoutMs(env: ProxyBindings): number {
	return Math.max(200, parseIntOr(env.PROXY_HEALTH_TIMEOUT_MS, 1500));
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

async function readFastestFromKv(
	env: ProxyBindings,
	targets: Target[],
): Promise<Target | null> {
	const kv = env.FASTEST_KV;
	if (!kv) return null;

	let cached: string | null = null;
	try {
		cached = await kv.get(kvKey(env));
	} catch {
		return null;
	}
	if (!cached) return null;
	try {
		const normalized = new URL(cached).toString().replace(/\/+$/, "/");
		return targets.find((t) => t.normalized === normalized) ?? null;
	} catch {
		return null;
	}
}

async function writeFastestToKv(
	env: ProxyBindings,
	fastest: Target,
): Promise<void> {
	const kv = env.FASTEST_KV;
	if (!kv) return;
	try {
		await kv.put(kvKey(env), fastest.normalized, {
			expirationTtl: kvTtlSeconds(env),
		});
	} catch {
		// ignore KV write failures
	}
}

function readFastestFromMemory(
	env: ProxyBindings,
	targets: Target[],
): Target | null {
	if (!inMemoryFastest) return null;
	if (Date.now() >= inMemoryFastest.expiresAtMs) return null;
	return (
		targets.find((t) => t.normalized === inMemoryFastest!.normalized) ?? null
	);
}

function writeFastestToMemory(env: ProxyBindings, fastest: Target): void {
	const ttlSeconds = kvTtlSeconds(env);
	inMemoryFastest = {
		normalized: fastest.normalized,
		expiresAtMs: Date.now() + ttlSeconds * 1000,
	};
}

function buildUpstreamUrl(target: Target, original: URL): URL {
	const upstream = new URL(target.baseUrl.toString());
	upstream.pathname = joinPaths(target.basePath, original.pathname);
	upstream.search = original.search;
	upstream.hash = "";
	return upstream;
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
		return new Response("Missing env: PROXY_TARGET or PROXY_TARGETS", {
			status: 500,
		});
	}

	const retryable = ["GET", "HEAD", "OPTIONS"].includes(
		request.method.toUpperCase(),
	);
	const retryOn5xx = retryable && shouldRetryOn5xx(env);

	const cached =
		readFastestFromMemory(env, targets) ??
		(await readFastestFromKv(env, targets));
	let primary = cached;
	if (!primary) {
		primary = (await probeTargets(targets, env)) ?? targets[0]!;
		writeFastestToMemory(env, primary);
		void writeFastestToKv(env, primary);
	}

	const ordered = [
		primary,
		...targets.filter((t) => t.normalized !== primary!.normalized),
	];
	const maxAttempts = retryable ? Math.min(ordered.length, 3) : 1;

	let lastError: unknown = null;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const target = ordered[attempt]!;
		try {
			const response = await fetchViaTarget(target, request);
			if (retryOn5xx && response.status >= 500 && attempt + 1 < maxAttempts) {
				response.body?.cancel();
				continue;
			}
			if (attempt === 0 && response.ok) {
				writeFastestToMemory(env, target);
				void writeFastestToKv(env, target);
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
