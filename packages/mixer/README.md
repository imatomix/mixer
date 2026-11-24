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

The request, the response being built, state passed between components, and helpers to read the body, set cookies, and run work after the response. See [ctx](https://github.com/imatomix/mixer/blob/main/docs/reference/context.md#ctx).

### What a component can return

A string, an object, bytes, a stream, `null`, or a `Response`. See [What a component can return](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.md#what-a-component-can-return).

### Redirects

`redirect(path)` goes only to paths on this site unless you list other origins. See [Redirects](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.md#redirects).

### Errors

Throw an `HttpError` to answer with its status; anything else is a `500` without details. See [Errors](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.md#errors).

### Error reports

`ctx.onErrorReport()` receives unexpected errors, including those after the response. See [Error reports](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.md#error-reports).

### Types

`new Mixer<State, Env>()` types `ctx.state` and `ctx.env`. See [Types](https://github.com/imatomix/mixer/blob/main/docs/reference/mixer.md#types).

## Running the app

`app.fetch(request)` is a plain Web standard handler, so the same app runs on Node.js and Bun through mixer's adapters, on Cloudflare Workers as `export default app`, and inside other frameworks on a catch-all route.

See [Running your app](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md) for [Node.js](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md#nodejs), [Bun](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md#bun), [Cloudflare Workers](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md#cloudflare-workers), and [inside frameworks](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md#inside-frameworks).

## Safe by default

Without any configuration, mixer sends `nosniff`, sets safe cookie attributes, keeps responses with cookies out of shared caches, answers errors without details, limits request bodies, redirects only within the site, and, with `serve()`, listens on `127.0.0.1` and rejects unknown host names. CSRF protection and security headers depend on the app, so they are one line each with mix-csrf and mix-secure-headers.

See [Safe by default](https://github.com/imatomix/mixer/blob/main/docs/explanation/safety.md) for the full list and the one thing mixer cannot decide for you.

## Reference

### Client IP address

`ctx.ip` is the client's address; `X-Forwarded-For` is used only for `trustedProxies`. See [Client IP address](https://github.com/imatomix/mixer/blob/main/docs/reference/mixer.md#client-ip-address).

### Returning a Response

A returned `Response` keeps its own status, body, and headers. See [Returning a Response](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.md#returning-a-response).

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

`ctx.cookies` reads and sets cookies, with safe attributes by default. See [Cookies](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.md#cookies).

### Request body

`ctx.json()`, `ctx.form()`, `ctx.text()`, and `ctx.bytes()` read the body within `bodyLimit` and accept only their own Content-Type; `validateInput()` checks it with a schema such as Zod. See [Reading and validating the request body](https://github.com/imatomix/mixer/blob/main/docs/how-to/request-body.md#request-body).

### Guarding routes

Check something once before a group of routes, such as the signed-in user from an authentication library, put it on `ctx.state`, and take it in routes with a small `requireX(ctx)` helper. See [Signing users in and guarding routes](https://github.com/imatomix/mixer/blob/main/docs/how-to/auth-and-guards.md#guarding-routes).

### basePath

Mounts the app under a path; `ctx.path` leaves it out. See [basePath](https://github.com/imatomix/mixer/blob/main/docs/reference/mixer.md#basepath).

### Options

`basePath`, `bodyLimit`, `trustedProxies`, and `onError`. See [Options](https://github.com/imatomix/mixer/blob/main/docs/reference/mixer.md#options).

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
