# @imatomix/mixer

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md)

A small web framework built on the Web standard `Request` and `Response`. You write an app as a list of functions, and mixer turns what they return into a safe response.

- **Web standard.** `app.fetch(request)` takes a `Request` and returns a `Response`, so the same app runs on Node.js, Bun, Cloudflare Workers, and inside Next.js, Nuxt, SvelteKit, or React Router
- **Safe by default.** `nosniff`, cookie attributes, cache rules for cookies, and error responses are right without extra code ([see below](#safe-by-default))
- **Pick what you need.** Routing, CORS, CSRF protection, security headers, static files, sessions, and logging are [separate modules](#modules), and any of them can be replaced
- TypeScript, ESM only, zero dependencies. Node.js 24 or later, Bun 1.4.4 or later, or Cloudflare Workers

> mixer is at 0.x, so the API may change between minor versions.

## Quick start

```sh
npm install @imatomix/mixer
```

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'

const app = new Mixer().mix(() => 'Hello mixer')

await serve(app, { port: 3000 })
```

Open http://localhost:3000. On Bun, use `serve` imported from `@imatomix/mixer/bun` instead; see [Running the app](#running-the-app) for the other places.

## The basics

### Components

An app is a list of **components**: functions that receive `ctx` and may return a response. Add them with `mix()`.

```ts
app.mix(
  (ctx) => {
    ctx.state.startedAt = Date.now() // returns nothing: hand over to the next one
  },
  (ctx) => {
    if (ctx.path === '/hello') return { hello: 'mixer' } // returns a value: this is the response
  },
)
```

Components run in the order they were mixed in and **stop at the first one that returns a value** (anything other than `undefined`). If none does, the response is `404`. Routing is a component too: see [mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router).

A component can also wrap the ones after it. `await next()` runs them and gives back the response they produced; the component then adds to it, such as a header or a cookie:

```ts
app.mix(
  async (ctx, next) => {
    const started = Date.now()
    await next() // runs everything after this component
    ctx.headers.set('X-Response-Time', `${Date.now() - started}ms`)
  },
  (ctx) => ({ hello: 'mixer' }),
)
```

See [Wrapping with next()](#wrapping-with-next) for the rules.

### ctx

| Property | Description |
| --- | --- |
| `ctx.request` | The Web standard `Request` |
| `ctx.url` | The request URL as a `URL` (`ctx.url.searchParams` for the query) |
| `ctx.path` | The path without `basePath`. Route on this |
| `ctx.method` | The HTTP method |
| `ctx.status` / `ctx.headers` | Status (default `200`) and headers of the response being built |
| `ctx.state` | Values passed to later components |
| `ctx.env` | Bindings and settings passed as the second argument of `app.fetch` |
| `ctx.ip` / `ctx.remoteAddress` | The client's IP address, and the direct peer's ([details](#client-ip-address)) |
| `await ctx.json()` / `await ctx.form()` | The request body as JSON, or as `FormData` from a form or file upload ([details](#request-body)) |
| `await ctx.text()` / `await ctx.bytes()` | The request body as a string or bytes |
| `ctx.cookies` | Read cookies and set them on the response ([details](#cookies)) |
| `ctx.error` | After `await next()`, the error a later component threw, if any ([details](#wrapping-with-next)) |
| `ctx.onErrorReport(fn)` | Receive unexpected errors for this request ([details](#error-reports)) |
| `ctx.waitUntil(promise)` | Run work after the response without delaying it ([details](#ctxwaituntil)) |

### What a component can return

| Value | Response |
| --- | --- |
| `string` | `text/plain; charset=utf-8` |
| Object, array, number, boolean | JSON (`application/json; charset=utf-8`) |
| `Uint8Array` / `ArrayBuffer` | `application/octet-stream` |
| `Blob` | Its own type, or `application/octet-stream` |
| `ReadableStream` | Streamed (`application/octet-stream`) |
| `null` | No body: `204`, or `ctx.status` if you set one (such as `304`) |
| `Response` | Used as is, with the headers you set added ([details](#returning-a-response)) |

A `Content-Type` you set in `ctx.headers` wins over these defaults.

```ts
app.mix((ctx) => {
  ctx.status = 201
  ctx.headers.set('Location', '/items/1')
  return { created: true }
})
```

### Redirects

```ts
import { redirect } from '@imatomix/mixer'

return redirect('/login') // 302
return redirect('/orders/1', { status: 303 }) // after a form POST
return redirect(ctx.url.searchParams.get('next'), { fallback: '/' }) // a value from the client
return redirect(url, { allowedOrigins: ['https://accounts.example.com'] }) // another site
```

`redirect()` refuses to send users to another site by mistake (an open redirect). By default the location must be a path on this site that starts with a single `/`; `//evil.example`, backslashes, whitespace and control characters, encoded `/` or `\`, `.` and `..` segments, and absolute URLs are rejected with a `TypeError`. For a value that comes from the client, give a `fallback` to use instead. Other sites must be listed in `allowedOrigins` by exact origin. The status is `302` by default (`301`, `303`, `307`, and `308` are accepted), and the path is not prefixed with `basePath`. Cookies set before redirecting are kept.

### Errors

Throw an `HttpError` to answer with its status and `{ "error": message }`. Any other error becomes `500`; its details go to `console.error`, never to the client.

```ts
import { HttpError } from '@imatomix/mixer'

app.mix((ctx) => {
  if (!ctx.request.headers.has('authorization')) throw new HttpError(401, 'Unauthorized')
})
```

Headers an error response needs go on the error itself. Headers and cookies set in `ctx.headers` and `ctx.cookies` before the error are not kept, so that what was meant for a normal response does not leak into the error. A component that must reach error responses too, such as one adding security headers or a session cookie, adds them after `await next()`.

```ts
throw new HttpError(429, 'Too Many Requests', { headers: { 'Retry-After': '60' } })
```

To shape error responses yourself, pass `onError`. It starts with the error's status in `ctx.status`, and what it returns becomes the response. If it returns `undefined` or throws, the default response is sent. `ctx.state` may be incomplete here, because the error can come before the components that fill it, or from a request outside `basePath` that no component saw, so its properties are optional in `onError` (write `ctx.state.log?.requestId`).

```ts
const app = new Mixer({
  onError: (error, ctx) => ({ message: 'Sorry', status: ctx.status }),
})
```

### Error reports

Unexpected errors are logged with `console.error`, together with the request's method and path: errors a component throws (also when `onError` turns them into a response), failures of `onError`, rejected `ctx.waitUntil()` work, and streams that fail to cancel. An `HttpError` below `500` is part of the response, not a failure, so it is not logged.

To send them somewhere else, such as your logger with the request's ID, register `ctx.onErrorReport(fn)`. While at least one listener is registered, mixer stops logging them itself. A listener that throws is logged and does not affect the response. A listener may return a Promise, for example to send the report over the network; the response does not wait for it, and it is kept alive like `ctx.waitUntil()` work.

```ts
app.mix((ctx) => {
  ctx.onErrorReport(({ error, phase }) => {
    myLogger.error({ method: ctx.method, path: ctx.url.pathname, phase, error })
  })
})
```

`phase` is one of `'handling'`, `'onError'`, `'waitUntil'`, and `'streamCancel'`. Mix the listener in first, so errors from every later component reach it. Failures of the Node.js adapter itself, outside any request's handling, are logged by the adapter.

### Types

```ts
type State = { user?: string }
type Env = { DATABASE_URL: string }

const app = new Mixer<State, Env>()
// ctx.state.user: string | undefined, ctx.env.DATABASE_URL: string
```

## Running the app

`app.fetch` is a plain `(request, env?, executionContext?) => Promise<Response>` handler, so each place below just passes requests to it.

### Node.js

```ts
import { serve } from '@imatomix/mixer/node'

const server = await serve(app, { port: 3000 })
server.port // the port in use (pass port: 0 for any free port)
await server.close()
```

`serve()` listens on `127.0.0.1` and accepts only local host names unless you say otherwise ([why](#safe-by-default)). To serve a domain, or other machines such as in a container:

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
- `X-Forwarded-For` is read only for `trustedProxies` ([client IP address](#client-ip-address)); `X-Forwarded-Proto` and `X-Forwarded-Host` are not used
- When a component does not read the request body (for example, after a `413`), the connection is closed instead of reading the rest
- When the client goes away, `ctx.request.signal` is aborted and a streaming body is cancelled
- `server.close()` stops accepting connections, closes idle ones, and ends each remaining connection once its requests have been answered. After `timeout` (10 seconds by default; `server.close({ timeout: 30_000 })`) it cuts the rest, which aborts their `ctx.request.signal`. Call it on `SIGTERM` to deploy without dropping requests

### Bun

```ts
import { serve } from '@imatomix/mixer/bun'

const server = await serve(app, { port: 3000 })
// When shutting down:
await server.close()
```

Like the Node.js adapter, this listens on `127.0.0.1` by default and rejects unknown Host names with 400. The only options are `hostname`, `port` (default `0`, any free port), and `allowedHosts`, with the same meanings as above. It passes `server.requestIP(request)` to `app.handle()` for `ctx.ip`, without putting Bun's server in `ctx.env`. `server.close()` waits for requests in progress to finish; it has no shutdown timeout option. If a handler throws or rejects, the adapter logs the error on the server and returns an empty 500 response, including in development mode.

### Cloudflare Workers

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
- `bodyLimit` applies when the body is read through `ctx.json()`, `ctx.form()`, `ctx.text()`, or `ctx.bytes()`, not when `ctx.request` is read directly. Work passed to `ctx.waitUntil()` is bound by the Workers time limits

| Package | On Workers |
| --- | --- |
| mixer, mix-router, mix-cors, mix-csrf, mix-secure-headers, mix-logger | Supported |
| mix-session | Supported with an external store (`MemoryStore` lives in one isolate) |
| mix-static | Not supported (no file system); use Workers Static Assets |
| `@imatomix/mixer/node` | Not used |

### Inside frameworks

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

## Safe by default

Without any configuration:

- Every response gets `X-Content-Type-Options: nosniff`
- Cookies are `HttpOnly; Secure; SameSite=Lax; Path=/`. Values are encoded, and names, paths, and domains that could inject headers are rejected
- A response that sets a cookie gets `Cache-Control: private` (unless it already says `private` or `no-store`), so shared caches never hand it to someone else
- Errors other than `HttpError` answer `500` without details. Error responses start from a fresh set of headers, so a `Location`, `Cache-Control`, or cookie meant for the normal response does not leak into the error
- Reading a request body over 3 MB answers `413`, and malformed JSON answers `400`. `ctx.json()` and `ctx.form()` accept only their own Content-Type (`415` otherwise), so a JSON route never parses a cross-site form
- `redirect()` only goes to paths on this site unless you list other origins
- `HEAD` responses and `204` / `205` / `304` carry no body, and a stream that will not be sent is cancelled
- `X-Forwarded-For` is ignored unless you list `trustedProxies`, so a client cannot forge `ctx.ip`
- On Node.js and Bun, `serve()` listens on `127.0.0.1` and accepts only local host names, which stops DNS rebinding (a page on another site reaching your server through a name that resolves to it) and forged `Host` headers

What depends on the app is left to modules, one line each: CSRF protection with [mix-csrf](https://github.com/imatomix/mixer/tree/main/packages/mix-csrf), and `X-Frame-Options`, `Referrer-Policy`, HSTS, or CSP with [mix-secure-headers](https://github.com/imatomix/mixer/tree/main/packages/mix-secure-headers). An app that serves pages to browsers should mix in both.

One more thing mixer cannot decide for you: **do not build absolute URLs from `ctx.url.host`** (for emails or redirects). The client chooses the `Host` header; use an origin from your configuration.

## Reference

### Client IP address

`ctx.ip` is the client's IP address, and `ctx.remoteAddress` the address of the direct peer (such as a reverse proxy). Both are normalized (an IPv4-mapped IPv6 address becomes IPv4) and are `undefined` when nothing supplied them: `app.fetch` alone knows no connection.

Adapters pass the address through `app.handle(request, options)`, which otherwise works like `app.fetch`:

| Option | Where it comes from | `ctx.ip` |
| --- | --- | --- |
| `remoteAddress` | The socket: the Node.js and Bun adapters pass it to `app.handle()` | The peer, or behind `trustedProxies` the client from `X-Forwarded-For` |
| `clientIp` | An address the platform or framework already resolved: Cloudflare's `CF-Connecting-IP`, SvelteKit's `getClientAddress()` | That address as it is; `X-Forwarded-For` is not read |

Behind reverse proxies, list them in `trustedProxies`. `X-Forwarded-For` is read only when the peer is one of them: from the right, trusted proxies are skipped and the first other address is the client, so values a client prepends are ignored. A malformed hop that has to be read, or a header over 8 KiB or 32 hops, falls back to the peer.

```ts
const app = new Mixer({ trustedProxies: ['10.0.0.0/8', '::1'] })
```

An IP address can be wrong behind a misconfigured proxy, NAT, or VPN, and many users can share one. Use it for logs and rate limits, not alone to decide who someone is.


### Returning a Response

A returned `Response` keeps its own status, body, and headers. Headers you set in `ctx.headers` that it does not have are added, `Set-Cookie` headers from both are kept (the `Response` wins for the same cookie), and the `Vary` lists of both are joined. `Response.error()` and a `Response` whose body was already read become `500`.

### Wrapping with next()

A component receives `next` as its second argument. `await next()` runs the components after it and resolves to the `Response` they produced; it never throws, because an error below has already been turned into the error response (through `onError` or the default), and the error is kept in `ctx.error`.

```ts
app.mix(
  async (ctx, next) => {
    await db.begin()
    await next()
    // A thrown error is in ctx.error; a 500 a handler returns on purpose is not an error
    if (ctx.error === undefined) await db.commit()
    else await db.rollback()
  },
  post('/orders', createOrder),
)
```

The rules:

- After `await next()`, `ctx.headers`, `ctx.cookies`, and `ctx.status` are those of the response it returned, so headers and cookies are added the same way as before. Use `ctx.headers` again after `next()`: a reference taken before it still points at the old draft
- After `next()`, return nothing to keep the response, or return a whole new `Response`. Returning any other value answers `500`, because it would go out with the old response's `Content-Type` and `Content-Length`
- Call `next()` once and await it. Calling it twice or after returning, or returning while the rest is still running, answers `500`
- **Put components whose headers or cookies must reach every response first**, such as mix-logger, mix-secure-headers, mix-cors, and mix-session. A component placed outside them that replaces the response would drop what they added
- mixer's own guarantees (`nosniff`, private caching of responses with cookies, no body for `HEAD`, `204`, and `304`) are applied after every component, so no component can undo them

`compose(...components)` runs a list as one group by the same rules: `next()` inside runs the rest of the group, then what follows it. mix-router's `namespace` is built on it, so a component inside a namespace wraps only that part of the app, such as JSON error pages under `/api`.

### ctx.waitUntil()

Runs work after the response without making the response wait. On a long-running server (`serve()`, `Bun.serve`) the work finishes as the process keeps running, and a failure is [reported](#error-reports). On platforms that may stop after the response, pass the platform's background-work API as the third argument, as in `app.fetch(request, env, { waitUntil })`; on Cloudflare Workers, `export default app` does this for you.

### Cookies

```ts
ctx.cookies.get('theme') // the first value if the name appears more than once
ctx.cookies.getAll('theme')
ctx.cookies.set('theme', 'dark', { maxAge: 60 * 60 * 24 })
ctx.cookies.delete('theme') // pass the same path / domain used when setting it
```

| Option | Default | Description |
| --- | --- | --- |
| `httpOnly` | `true` | Hide the cookie from JavaScript |
| `secure` | `true` | Send only over HTTPS. Set to `false` when developing on http://localhost |
| `sameSite` | `'Lax'` | `'Strict'` / `'Lax'` / `'None'` |
| `path` | `'/'` | |
| `maxAge` / `expires` / `domain` / `partitioned` / `priority` | none | |

- Setting the same name, path, and domain again in one response replaces the earlier value
- Combinations that browsers reject (such as `SameSite=None` without `Secure`, or `__Host-` with a `Domain`) throw a `TypeError`
- Setting cookies after the response is final throws

### Request body

Say which kind of body a route expects. Each reader accepts only its own Content-Type and answers `415` otherwise, before reading anything:

| Method | Accepts | Result |
| --- | --- | --- |
| `ctx.json()` | `application/json`, `application/*+json` | The parsed value as `unknown` (`400` if invalid or empty) |
| `ctx.form()` | `application/x-www-form-urlencoded`, `multipart/form-data` | `FormData`: `get(name)` and `getAll(name)` give strings, or `File`s for uploads (`400` if malformed) |
| `ctx.text()` / `ctx.bytes()` | anything | A string / a `Uint8Array` |

A JSON route therefore never parses a form or `text/plain`, which browsers send from other sites without asking first. That keeps a JSON route from being reached by a plain cross-site form, but it does not replace CSRF protection for routes that rely on cookies: use mix-csrf for those.

The values come from the client, so check them before use; `ctx.json()` returns `unknown` for that reason:

```ts
post('/todos', async (ctx) => {
  const form = await ctx.form()
  const title = form.get('title')
  if (typeof title !== 'string' || title.length === 0 || title.length > 200) {
    throw new HttpError(422, 'A title is between 1 and 200 characters')
  }
  // ...
})
```

The body is read only when asked, and every reader returns the same content however many times it is called. The whole body is read into memory within `bodyLimit` (3 MB by default), so raise the limit for larger uploads; streaming very large files to storage is not covered.

### basePath

```ts
const app = new Mixer({ basePath: '/api' })
// GET /api/users → ctx.path === '/users'; requests outside /api get 404
```

`ctx.url` keeps the full URL. Modules route on `ctx.path`, so they work under `basePath` unchanged.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `basePath` | none | Path the app is mounted on |
| `bodyLimit` | 3 MB | Largest request body that `ctx.json()`, `ctx.form()`, `ctx.text()`, and `ctx.bytes()` read; larger ones answer `413` |
| `onError` | none | `(error, ctx) => value` to shape error responses |
| `trustedProxies` | none | Reverse proxies (IP addresses or CIDR ranges) whose `X-Forwarded-For` is read for `ctx.ip` |

## Modules

Install only the ones you need. Each is a component, so you can replace any of them with your own.

| Package | Description |
| --- | --- |
| [@imatomix/mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router) | Type-safe router |
| [@imatomix/mix-cors](https://github.com/imatomix/mixer/tree/main/packages/mix-cors) | CORS |
| [@imatomix/mix-csrf](https://github.com/imatomix/mixer/tree/main/packages/mix-csrf) | CSRF protection |
| [@imatomix/mix-secure-headers](https://github.com/imatomix/mixer/tree/main/packages/mix-secure-headers) | Security headers |
| [@imatomix/mix-static](https://github.com/imatomix/mixer/tree/main/packages/mix-static) | Static files (Node.js and Bun) |
| [@imatomix/mix-session](https://github.com/imatomix/mixer/tree/main/packages/mix-session) | Server-side sessions |
| [@imatomix/mix-logger](https://github.com/imatomix/mixer/tree/main/packages/mix-logger) | Request-scoped logs |

## Development

See the [repository root](https://github.com/imatomix/mixer/tree/main) and [CONTRIBUTING.md](https://github.com/imatomix/mixer/blob/main/CONTRIBUTING.md).
