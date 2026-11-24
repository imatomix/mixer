# Running your app

English | [日本語](runtimes.ja.md)

`app.fetch` is a plain `(request, env?, executionContext?) => Promise<Response>` handler, so each place below just passes requests to it.

## Node.js

```ts
import { serve } from '@imatomix/mixer/node'

const server = await serve(app, { port: 3000 })
server.port // the port in use (pass port: 0 for any free port)
await server.close()
```

`serve()` listens on `127.0.0.1` and accepts only local host names unless you say otherwise ([why](../../packages/mixer/README.md#safe-by-default)). To serve a domain, or other machines such as in a container:

```ts
await serve(app, {
  port: 3000,
  hostname: '0.0.0.0', // accept connections from other machines
  allowedHosts: ['example.com', 'www.example.com'],
})
```

| Option | Default | Description |
| --- | --- | --- |
| `port` | `0` (any free port) | |
| `hostname` | `'127.0.0.1'` | Address to listen on |
| `allowedHosts` | none | Host names to accept besides `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`, and an IP address given as `hostname`. Exact match, ignoring case and the port. `true` accepts any name; use it only when something in front already checks it |

- Other host names get an empty `400` and never reach the app; the first one is logged with `console.warn`
- A request with no `Host`, more than one, or anything other than a plain host and port gets `400`
- `X-Forwarded-For` is read only for `trustedProxies` ([client IP address](../../packages/mixer/README.md#client-ip-address)); `X-Forwarded-Proto` and `X-Forwarded-Host` are not used
- When a component does not read the request body (for example, after a `413`), the connection is closed instead of reading the rest
- When the client goes away, `ctx.request.signal` is aborted and a streaming body is cancelled
- A client that sends slowly is cut by Node's own limits: 60 seconds for the headers and 300 seconds for the whole request. They cover receiving only, not a slow handler or a streaming response ([slow work](streaming-and-background-work.md#slow-work))
- `server.close()` stops accepting connections, closes idle ones, and ends each remaining connection once its requests have been answered. After `timeout` (10 seconds by default; `server.close({ timeout: 30_000 })`) it cuts the rest, which aborts their `ctx.request.signal`. Call it on `SIGTERM` to deploy without dropping requests

## Bun

```ts
import { serve } from '@imatomix/mixer/bun'

const server = await serve(app, { port: 3000 })
// When shutting down:
await server.close()
```

Like the Node.js adapter, this listens on `127.0.0.1` by default and rejects unknown Host names with 400. The only options are `hostname`, `port` (default `0`, any free port), and `allowedHosts`, with the same meanings as above. It passes `server.requestIP(request)` to `app.handle()` for `ctx.ip`, without putting Bun's server in `ctx.env`. `server.close()` waits for requests in progress to finish; it has no shutdown timeout option. If a handler throws or rejects, the adapter logs the error on the server and returns an empty 500 response, including in development mode. Bun closes a connection that sends nothing for 10 seconds (its default `idleTimeout`), so a handler that works longer than that before answering, or a stream that pauses that long, is cut.

## Cloudflare Workers

```ts
type Env = { DATABASE_URL: string }

const app = new Mixer<Record<string, unknown>, Env>().mix((ctx) => ctx.env.DATABASE_URL)

export default app satisfies ExportedHandler<Env>
```

For `ctx.ip`, pass the address Cloudflare resolved. mixer does not read `CF-Connecting-IP` by itself, because elsewhere anyone can send that header:

```ts
export default {
  fetch: (request, env, executionContext) =>
    app.handle(request, {
      env,
      executionContext,
      clientIp: request.headers.get('cf-connecting-ip') ?? undefined,
    }),
} satisfies ExportedHandler<Env>
```

- `ctx.env` holds the Worker's bindings, and `ctx.waitUntil()` hands work to the Worker's `ctx.waitUntil`. With mix-router, give the bindings' type to `createRouter<State, Env>()` as well
- Checked on every pull request on workerd at compatibility date `2026-07-30`, with Node.js compatibility turned off (`no_nodejs_compat`, `no_nodejs_compat_v2`), and type-checked with `@cloudflare/workers-types`. mixer does not need `nodejs_compat`
- `ctx.request.signal` is aborted when the client goes away only from compatibility date `2026-11-17`, or with the `enable_request_signal` flag before it
- `bodyLimit` applies when the body is read through `ctx.json()`, `ctx.form()`, `ctx.text()`, or `ctx.bytes()`, not when `ctx.request` is read directly. Work passed to `ctx.waitUntil()` is bound by the Workers time limits

| Package | On Workers |
| --- | --- |
| mixer, mix-router, mix-cors, mix-csrf, mix-secure-headers, mix-logger | Supported |
| mix-session | Supported with an external store (`MemoryStore` lives in one isolate) |
| mix-static | Not supported (no file system); use Workers Static Assets |
| `@imatomix/mixer/node` | Not used |

## Inside frameworks

Mount mixer on a catch-all route of your framework, set `basePath` to that route's path, and pass only the `Request`: frameworks give handlers other arguments, which would otherwise become `ctx.env`. For `ctx.ip`, use `app.handle(request, { clientIp })` with the framework's own address API, such as SvelteKit's `getClientAddress()`.

**Next.js** (App Router), `app/api/[[...path]]/route.ts`:

```ts
const app = new Mixer({ basePath: '/api' }).mix(/* ... */)
const handler = (request: Request) => app.fetch(request)

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE }
```

**Nuxt** (Nuxt 4, h3 v1), `server/api/[...path].ts` (with h3 v2, pass `event.req`):

```ts
const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export default defineEventHandler((event) => app.fetch(toWebRequest(event)))
```

**SvelteKit**, `src/routes/api/[...path]/+server.ts`:

```ts
import type { RequestHandler } from './$types'

const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export const fallback: RequestHandler = ({ request }) => app.fetch(request)
```

**React Router** (v7, framework mode), a resource route such as `app/routes/api.$.ts`:

```ts
import type { Route } from './+types/api.$'

const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export const loader = ({ request }: Route.LoaderArgs) => app.fetch(request)
export const action = ({ request }: Route.ActionArgs) => app.fetch(request)
```
