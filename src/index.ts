import { Hono } from 'hono'
import { proxyFetch, type ProxyBindings } from './proxy'

const app = new Hono<{ Bindings: ProxyBindings }>()

app.all('*', (c) => proxyFetch(c.req.raw, c.env))

export default app
