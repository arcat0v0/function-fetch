import type { ProxyBindings } from "./proxy.js";
import { proxyFetch } from "./proxy.js";

function buildEnv(env: ProxyBindings): ProxyBindings {
	return {
		...(process.env as Record<string, string | undefined> as ProxyBindings),
		...(env ?? {}),
	};
}

const worker = {
	async fetch(request: Request, env: ProxyBindings) {
		return proxyFetch(request, buildEnv(env));
	},
};

export default worker;
