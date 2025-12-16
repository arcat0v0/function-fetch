import http from "node:http";

import { createNodeHandler } from "./node.js";

const handler = createNodeHandler();
const port = Number.parseInt(process.env.PORT ?? "8787", 10) || 8787;

http
	.createServer((req, res) => {
		void handler(req, res);
	})
	.listen(port, () => {
		console.log(`listening on http://localhost:${port}`);
	});
