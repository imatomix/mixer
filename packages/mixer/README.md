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

`phase` is one of `'handling'`, `'onError'`, `'waitUntil'`, `'streamCancel'`, and `'stream'` (an error thrown by an [`sse()`](#server-sent-events) producer). Mix the listener in first, so errors from every later component reach it. Failures of the Node.js adapter itself, outside any request's handling, are logged by the adapter.

### Types

```ts
type State = { user?: string }
type Env = { DATABASE_URL: string }

const app = new Mixer<State, Env>()
// ctx.state.user: string | undefined, ctx.env.DATABASE_URL: string
```

## Running the app

`app.fetch(request)` is a plain Web standard handler, so the same app runs on Node.js and Bun through mixer's adapters, on Cloudflare Workers as `export default app`, and inside other frameworks on a catch-all route.

See [Running your app](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md) for [Node.js](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md#nodejs), [Bun](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md#bun), [Cloudflare Workers](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md#cloudflare-workers), and [inside frameworks](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md#inside-frameworks).

## Safe by default

Without any configuration, mixer sends `nosniff`, sets safe cookie attributes, keeps responses with cookies out of shared caches, answers errors without details, limits request bodies, redirects only within the site, and, with `serve()`, listens on `127.0.0.1` and rejects unknown host names. CSRF protection and security headers depend on the app, so they are one line each with mix-csrf and mix-secure-headers.

See [Safe by default](https://github.com/imatomix/mixer/blob/main/docs/explanation/safety.md) for the full list and the one thing mixer cannot decide for you.

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

A component receives `next` as its second argument. `await next()` runs the components after it and resolves to their `Response`; it never throws, and an error below is kept in `ctx.error`. After it, change `ctx.headers`, `ctx.cookies`, or `ctx.status`, or return a whole new `Response`.

See [Composing components with next()](https://github.com/imatomix/mixer/blob/main/docs/explanation/composition.md) for an example and the rules.

### Server-Sent Events

`sse(ctx, async (stream, signal) => ...)` sends events safely, with a heartbeat and a stop when the client goes away. See [Server-Sent Events](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.md#server-sent-events).

### Slow work

mixer has no time limit for a whole route; put a limit on each outgoing call so the work itself stops. See [Slow work](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.md#slow-work).

### ctx.waitUntil()

Runs work after the response without making it wait. See [ctx.waitUntil()](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.md#ctxwaituntil).

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

`ctx.json()`, `ctx.form()`, `ctx.text()`, and `ctx.bytes()` read the body within `bodyLimit` and accept only their own Content-Type; `validateInput()` checks it with a schema such as Zod. See [Reading and validating the request body](https://github.com/imatomix/mixer/blob/main/docs/how-to/request-body.md#request-body).

### Guarding routes

Check something once before a group of routes, such as the signed-in user from an authentication library, put it on `ctx.state`, and take it in routes with a small `requireX(ctx)` helper. See [Signing users in and guarding routes](https://github.com/imatomix/mixer/blob/main/docs/how-to/auth-and-guards.md#guarding-routes).

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
| `bodyLimit` | 3 MB | Largest request body that `ctx.json()`, `ctx.form()`, `ctx.text()`, and `ctx.bytes()` read; larger ones answer `413`. A read can pass its own `bodyLimit` for one route ([details](#request-body)) |
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
