import { Hono } from "hono";
import { type ProxyBindings, proxyFetch } from "./proxy.js";

const app = new Hono<{ Bindings: ProxyBindings }>();

app.all("*", (c) => proxyFetch(c.req.raw, c.env));

export default app;
