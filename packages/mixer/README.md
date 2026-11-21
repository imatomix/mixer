# mixer

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md)

Minimal & asynchronous web module, built on the Web standard `Request` and `Response`.

- Written in TypeScript, ESM only, zero dependencies
- Node.js 24 or later, Bun 1.4.4 or later, or Cloudflare Workers
- `app.fetch(request)` is a plain Web standard handler, so it also runs inside frameworks such as Next.js, Nuxt, SvelteKit, and React Router
- Safe by default: `X-Content-Type-Options: nosniff` on every response, cookies are `HttpOnly; Secure; SameSite=Lax`, responses that set cookies stay out of shared caches, and error details never reach the client

> **Note:** mixer is at 0.x, so the API may change between minor versions.

## Install

```sh
npm install @imatomix/mixer
```

## Usage

Add functions (components) that run on each request with `mix()`.
A component receives a single `ctx`, and the value it returns becomes the response.

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'

const app = new Mixer().mix(() => 'Hello Mixer')

await serve(app, { port: 3000 })
```

On Bun, pass `app.fetch` to `Bun.serve`:

```ts
Bun.serve({ port: 3000, fetch: app.fetch })
```

### mix()

Chain `mix()` calls, or pass several functions to one `mix()`.

```ts
app.mix(fn).mix(fn).mix(fn)
app.mix(fn, fn, fn)
```

Components run in the order they were mixed in, and **stop at the first one that returns a value (anything other than `undefined`)**.
A component that returns nothing hands over to the next one. If no component responds, the response is `404`.

### ctx

| Property | Description |
| --- | --- |
| `ctx.request` | The Web standard `Request` |
| `ctx.url` | The request URL as a `URL` object (`ctx.url.pathname`, `ctx.url.searchParams`) |
| `ctx.path` | The path without `basePath` (see below). Route on this |
| `ctx.method` | The HTTP method |
| `ctx.status` | Status of the response (default `200`) |
| `ctx.headers` | Headers of the response (a `Headers` object) |
| `ctx.state` | A place to pass values to later components |
| `ctx.env` | The second argument of `app.fetch` (bindings on serverless platforms) |
| `await ctx.body()` | The body, parsed according to its Content-Type |
| `await ctx.text()` / `await ctx.bytes()` | The body as a string / `Uint8Array` |
| `ctx.cookies` | Read cookies and add Set-Cookie headers (see below) |
| `ctx.onBeforeSend(fn)` | Run work right before the response is built (see below) |
| `ctx.onResponse(fn)` | Run work once the response is ready (see below) |
| `ctx.waitUntil(promise)` | Run work after the response without delaying it (see below) |

`ctx.status` and `ctx.headers` are a draft of the response. mixer builds the `Response` once, from the draft and the returned value.

### Responses

The format is chosen from the type of the returned value. A `Content-Type` set earlier in `ctx.headers` takes precedence.

| Value | Response |
| --- | --- |
| `string` | `text/plain; charset=utf-8` |
| `Uint8Array` / `ArrayBuffer` | `application/octet-stream` |
| `Blob` | Its own type, or `application/octet-stream` |
| `ReadableStream` | Streamed as is (`application/octet-stream`) |
| Object, number, boolean | JSON (`application/json; charset=utf-8`) |
| `null` | `204 No Content` (or `ctx.status` if you set one, such as `304`) |
| `Response` | Used as is, combined with the draft (see below) |

```ts
app.mix((ctx) => {
  ctx.status = 201
  ctx.headers.set('Location', '/items/1')
  return { created: true }
})
```

A returned `Response` keeps its own status, body, and headers. Draft headers it does not have are added, `Set-Cookie` from both are kept (the `Response` wins for the same cookie), and `Vary` lists from both are joined.
`Response.error()` and a `Response` whose body was already read become `500`.

Every response gets `X-Content-Type-Options: nosniff`. A response that sets cookies gets `Cache-Control: private` unless it already says `private` or `no-store`. `HEAD` responses and `204` / `205` / `304` have no body.

### ctx.onBeforeSend()

Registers work to run right before the response is built. Hooks run in registration order and can change `ctx.status`, `ctx.headers`, and cookies.
Use it to apply state that later components changed, such as a session cookie.

```ts
app
  .mix((ctx) => {
    ctx.onBeforeSend(() => {
      ctx.headers.set('X-User', ctx.state.user ?? 'guest')
    })
  })
  .mix((ctx) => {
    ctx.state.user = 'imatomix'
    return 'ok'
  })
```

- Runs once, for every response, including `404` and error responses
- If a hook throws, the response is `500` (hooks are not run again)

### ctx.onResponse()

Registers work to run once the final response is ready, such as logging. The hook receives a snapshot `{ status, headers }`; changing it has no effect.
Hooks run before `app.fetch` resolves, so keep them short and pass slow work to `ctx.waitUntil()`. A failing hook is logged and does not affect the response.

```ts
app.mix((ctx) => {
  ctx.onResponse(({ status }) => {
    ctx.waitUntil(sendMetrics(ctx.path, status))
  })
})
```

### ctx.waitUntil()

Runs work after the response without making the response wait for it. Whether the work is kept alive depends on where the app runs:

- **Long-running servers** (`serve()`, `Bun.serve`): the process keeps running, so the work finishes. A failure is logged with `console.error`
- **Platforms that may stop after the response** (serverless functions): pass the platform's background-work API as the third argument of `app.fetch`, as in `app.fetch(request, env, { waitUntil })`. Without it, mixer cannot tell the platform about the work, and it may be cut off

### ctx.cookies

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

- Values are URL-encoded when sent and decoded when read
- Setting the same name, path, and domain again in one response replaces the earlier value. Set-Cookie headers added in other ways are kept
- Names, paths, and domains that could inject headers, and combinations that browsers reject (such as `SameSite=None` without Secure, or `__Host-` with a Domain), throw a `TypeError`
- `set` / `delete` after the response is final throw

### Request body

`ctx.body()` reads the body only when needed, and returns the same result however many times it is called.

| Content-Type | Result |
| --- | --- |
| `application/json`, `*+json` | The value from `JSON.parse` (`400` if invalid) |
| `application/x-www-form-urlencoded` | `{ key: value }` (repeated keys become arrays) |
| `text/*` or none | A string |
| Anything else | A `Uint8Array` |
| Empty body | `undefined` |

Bodies over the limit (default 3 MB) get `413`.

```ts
const app = new Mixer({ bodyLimit: 1024 * 1024 })
```

### basePath

Mount the app under a path. Requests outside it get `404`, and `ctx.path` is the path below it (`ctx.url` keeps the full URL).

```ts
const app = new Mixer({ basePath: '/api' })
// GET /api/users → ctx.path === '/users'
```

### ctx.state, ctx.env, and types

```ts
type State = { user?: string }
type Env = { DATABASE_URL: string }

const app = new Mixer<State, Env>()

app
  .mix((ctx) => {
    ctx.state.user = 'imatomix'
  })
  .mix((ctx) => `hello ${ctx.state.user}`)
```

### Error handling

Throwing an `HttpError` responds with its status and `{ "error": message }` (status must be 400–599).
Any other error becomes `500`, and the details are logged with `console.error` instead of being shown to the client.

```ts
import { HttpError, Mixer } from '@imatomix/mixer'

app.mix((ctx) => {
  if (!ctx.state.user) throw new HttpError(401, 'Unauthorized')
})
```

Error responses start from a fresh draft: only `Access-Control-*`, `Vary`, and `Set-Cookie` are carried over, so a `Location` or `Cache-Control` meant for the normal response does not leak into the error.

Replace error responses with `onError`. It starts with the error's status in `ctx.status`, and its return value becomes the response. If it returns `undefined` or throws, the default response is sent.

```ts
const app = new Mixer({
  onError: (error, ctx) => ({ message: 'Sorry', status: ctx.status }),
})
```

## Running the app

### Node.js

`serve` from `@imatomix/mixer/node` runs the app on Node's `http` module.

```ts
import { serve } from '@imatomix/mixer/node'

const server = await serve(app, { port: 3000 })
server.port // the port in use (pass port: 0 for any free port)
await server.close()
```

**Safe by default:**

- It listens on `127.0.0.1` (this machine only) unless you pass `hostname`
- It accepts only the host names `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`, and an IP address given as `hostname`. Requests for any other host name get an empty `400` and never reach the app, and the first one is logged with `console.warn`. This stops DNS rebinding (a page on another site reaching your server through a name that resolves to it) and forged `Host` headers

To serve a domain, or other machines (for example, in a container), say so:

```ts
await serve(app, {
  port: 3000,
  hostname: '0.0.0.0', // accept connections from other machines
  allowedHosts: ['example.com', 'www.example.com'], // exact names; case and port are ignored
})
```

`allowedHosts: true` accepts any host name; use it only when something in front of the app (such as a reverse proxy) already checks it. `X-Forwarded-*` headers are not used.

- The request URL is built from the `Host` header. A request with no `Host`, more than one, or anything other than a plain host and port gets `400`
- **Build absolute URLs from a configured origin**, not from `ctx.url.host`, for emails and redirects. With `allowedHosts` the host is one you listed, but it is still the client's choice among them
- When a component does not read the request body (for example, after a `413`), the connection is closed instead of reading the rest
- When the client goes away, `ctx.request.signal` is aborted and a streaming body is cancelled

### Bun

```ts
Bun.serve({ port: 3000, fetch: app.fetch })
```

`Bun.serve` does not check host names; the checks above belong to `serve()` from `@imatomix/mixer/node`. When you run a development server on Bun, pass `hostname: '127.0.0.1'` and avoid trusting `ctx.url.host`.

### Cloudflare Workers

A `Mixer` is a Workers handler as it is: export it as the default export.

```ts
import { Mixer } from '@imatomix/mixer'

type Env = { DATABASE_URL: string }

const app = new Mixer<Record<string, unknown>, Env>().mix((ctx) => ctx.env.DATABASE_URL)

export default app satisfies ExportedHandler<Env>
```

- `ctx.env` holds the Worker's bindings, and `ctx.waitUntil()` passes work to the Worker's `ctx.waitUntil`. With mix-router, give the bindings' type to `createRouter<State, Env>()` as well
- Checked on every pull request with workerd at compatibility date `2026-07-30`, with Node.js compatibility turned off (`no_nodejs_compat`, `no_nodejs_compat_v2`), and type-checked with `@cloudflare/workers-types`. mixer does not need `nodejs_compat`

| Package | On Workers |
| --- | --- |
| `@imatomix/mixer`, mix-router, mix-cors, mix-logger | Supported |
| mix-session | Supported with an external store (`MemoryStore` lives in one isolate, and requests may run in different ones) |
| mix-static | Not supported (no file system). Serve static files with Workers Static Assets |
| `@imatomix/mixer/node` | Not used (Node.js only) |

Notes:

- **The host name is not trusted** here either: build absolute URLs from a configured origin, not from `ctx.url.host`
- `bodyLimit` applies when the body is read through `ctx.body()`, `ctx.text()`, or `ctx.bytes()`. Reading `ctx.request` directly bypasses it
- Work passed to `ctx.waitUntil()` is bound by the Workers time limits

### Inside frameworks

`app.fetch` takes a `Request` and returns a `Response`, so it can serve a part of an app built with a framework. Set `basePath` to the path where it is mounted.
Pass only the `Request`: frameworks give their handlers other arguments, which would otherwise become `ctx.env`.

**Next.js** (App Router), `app/api/[[...path]]/route.ts`:

```ts
const app = new Mixer({ basePath: '/api' }).mix(/* ... */)
const handler = (request: Request) => app.fetch(request)

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE }
```

**Nuxt** (Nuxt 4, h3 v1), `server/api/[...path].ts`:

```ts
const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export default defineEventHandler((event) => app.fetch(toWebRequest(event)))
```

With h3 v2, pass `event.req`, which is already a `Request`.

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

# Examples

### async/await

```ts
const app = new Mixer().mix(async () => {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  return 'Good Morning Mixer'
})
```

### Streaming

```ts
app.mix(() => {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      for (const word of ['mix', 'and', 'match']) {
        controller.enqueue(encoder.encode(`${word}\n`))
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      controller.close()
    },
  })
})
```

## Migrating from v0.1

| v0.1 | v0.2 |
| --- | --- |
| `await app.listen(3000)` | `await serve(app, { port: 3000 })` from `@imatomix/mixer/node` |
| `app.close()`, `app.address` | `server.close()`, `server.port` |
| `listen()` on all interfaces, any `Host` | `serve()` listens on `127.0.0.1` and accepts local host names only: pass `hostname` and `allowedHosts` for others |
| `app.handler` (`(req, res)`) | `app.fetch` (`(request) => Response`) |
| `ctx.req` | `ctx.request` (a Web standard `Request`) |
| `ctx.req.headers.origin` | `ctx.request.headers.get('origin')` |
| `ctx.res.setHeader(name, value)` | `ctx.headers.set(name, value)` |
| `ctx.send(status, body)` | `ctx.status = status; return body` or `return new Response(body, { status })` |
| Writing to `ctx.res` directly | Return a `ReadableStream` or a `Response` |
| `await ctx.buffer()` (`Buffer`) | `await ctx.bytes()` (`Uint8Array`) |
| Returning a Node `Readable` | Return a `ReadableStream` (`Readable.toWeb(stream)`) |
| `onError: (error, ctx) => ctx.send(...)` | `onError: (error, ctx) => value` |
| Routing on `ctx.url.pathname` | Route on `ctx.path` (works with `basePath`) |

## Modules

Pick only the ones you need.

- [@imatomix/mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router): type-safe router
- [@imatomix/mix-cors](https://github.com/imatomix/mixer/tree/main/packages/mix-cors): CORS
- [@imatomix/mix-static](https://github.com/imatomix/mixer/tree/main/packages/mix-static): static file serving
- [@imatomix/mix-session](https://github.com/imatomix/mixer/tree/main/packages/mix-session): server-side sessions
- [@imatomix/mix-logger](https://github.com/imatomix/mixer/tree/main/packages/mix-logger): access logging

## Development

Run `pnpm check` at the [repository root](https://github.com/imatomix/mixer/tree/main). See [CONTRIBUTING.md](https://github.com/imatomix/mixer/blob/main/CONTRIBUTING.md) for details.
