import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { type ProxyBindings, proxyFetch } from "./proxy";

export type NodeProxyOptions = {
	env?: Partial<ProxyBindings>;
	kvNamespace?: KVNamespace;
};

function buildBindings(options?: NodeProxyOptions): ProxyBindings {
	const baseEnv = process.env as Record<string, string | undefined>;
	const env: ProxyBindings = {
		...(baseEnv as ProxyBindings),
		...(options?.env as ProxyBindings),
	};

	if (options?.kvNamespace) env.FASTEST_KV = options.kvNamespace;

	return env;
}

function toHeaders(req: IncomingMessage): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value == null) continue;
		if (Array.isArray(value)) {
			for (const v of value) headers.append(key, v);
			continue;
		}
		headers.set(key, value);
	}
	return headers;
}

async function toRequest(req: IncomingMessage): Promise<Request> {
	const headers = toHeaders(req);
	const origin = `http://${headers.get("host") ?? "localhost"}`;
	const url = new URL(req.url ?? "/", origin);

	const init: RequestInit = {
		method: req.method,
		headers,
	};

	const method = req.method?.toUpperCase() ?? "GET";
	if (method !== "GET" && method !== "HEAD") {
		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
		}
		init.body = Buffer.concat(chunks);
	}

	return new Request(url.toString(), init);
}

function writeSetCookie(res: ServerResponse, response: Response): void {
	const getSetCookie = (response.headers as Headers & {
		getSetCookie?: () => string[];
	}).getSetCookie;

	if (typeof getSetCookie === "function") {
		const cookies = getSetCookie();
		if (cookies.length) res.setHeader("set-cookie", cookies);
		return;
	}

	const cookie = response.headers.get("set-cookie");
	if (cookie) res.setHeader("set-cookie", cookie);
}

async function sendNodeResponse(
	res: ServerResponse,
	response: Response,
): Promise<void> {
	res.statusCode = response.status;
	res.statusMessage = response.statusText || res.statusMessage;

	for (const [key, value] of response.headers) {
		if (key.toLowerCase() === "set-cookie") continue;
		res.setHeader(key, value);
	}
	writeSetCookie(res, response);

	const body = response.body;
	if (!body) {
		res.end();
		return;
	}

	try {
		const nodeStream = Readable.fromWeb(
			body as unknown as import("node:stream/web").ReadableStream,
		);
		nodeStream.on("error", () => res.destroy());
		nodeStream.pipe(res);
		return;
	} catch {
		const buffer = Buffer.from(await response.arrayBuffer());
		res.end(buffer);
	}
}

export function createNodeHandler(options?: NodeProxyOptions) {
	const env = buildBindings(options);

	return async function handler(req: IncomingMessage, res: ServerResponse) {
		try {
			const request = await toRequest(req);
			const response = await proxyFetch(request, env);
			await sendNodeResponse(res, response);
		} catch (err) {
			console.error("Proxy handler error", err);
			if (!res.headersSent) res.statusCode = 500;
			if (!res.writableEnded) res.end("Internal Server Error");
		}
	};
}
