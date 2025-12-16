import type { ProxyBindings } from "./proxy.js";
import { proxyFetch } from "./proxy.js";

import { ESA_BUILD_ENV } from "./esa_build_env.generated.js";

const worker = {
	async fetch(request: Request, env: ProxyBindings) {
		return proxyFetch(request, {
			...(ESA_BUILD_ENV as ProxyBindings),
			...(env ?? {}),
		});
	},
};

export default worker;
