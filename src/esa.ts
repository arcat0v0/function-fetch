import type { ProxyBindings } from "./proxy";
import { proxyFetch } from "./proxy";

const worker = {
	async fetch(request: Request, env: ProxyBindings) {
		return proxyFetch(request, env);
	},
};

export default worker;
