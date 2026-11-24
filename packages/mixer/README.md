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

Open http://localhost:3000. On Bun, use `serve` imported from `@imatomix/mixer/bun` instead; see [Running your app](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md) for the other places.

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

See [Composing components with next()](https://github.com/imatomix/mixer/blob/main/docs/explanation/composition.md) for the rules. What `ctx` holds and what a component can return are in the [reference](https://github.com/imatomix/mixer/blob/main/docs/reference/context.md).

## Safe by default

Without any configuration, mixer sends `nosniff`, sets safe cookie attributes, keeps responses with cookies out of shared caches, answers errors without details, limits request bodies, redirects only within the site, and, with `serve()`, listens on `127.0.0.1` and rejects unknown host names. CSRF protection and security headers depend on the app, so they are one line each with mix-csrf and mix-secure-headers.

See [Safe by default](https://github.com/imatomix/mixer/blob/main/docs/explanation/safety.md) for the full list and the one thing mixer cannot decide for you.

## Documentation

The [documentation map](https://github.com/imatomix/mixer/blob/main/docs/README.md) lists everything by what you want to do. The main pages:

- **Run your app**: [Node.js, Bun, Cloudflare Workers, and inside other frameworks](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md)
- **Do common tasks**: [sign users in and guard routes](https://github.com/imatomix/mixer/blob/main/docs/how-to/auth-and-guards.md), [read and validate the request body](https://github.com/imatomix/mixer/blob/main/docs/how-to/request-body.md), [stream events and run background work](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.md), [test your app](https://github.com/imatomix/mixer/blob/main/docs/how-to/testing.md)
- **Look things up**: [Mixer options and types](https://github.com/imatomix/mixer/blob/main/docs/reference/mixer.md), [ctx](https://github.com/imatomix/mixer/blob/main/docs/reference/context.md), [responses, errors, and cookies](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.md)
- **Understand the design**: [safe by default](https://github.com/imatomix/mixer/blob/main/docs/explanation/safety.md), [composing with next()](https://github.com/imatomix/mixer/blob/main/docs/explanation/composition.md), [decision records](https://github.com/imatomix/mixer/tree/main/docs/adr)

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
| [@imatomix/mix-compress](https://github.com/imatomix/mixer/tree/main/packages/mix-compress) | Response compression (Node.js and Bun) |

## Development

See the [repository root](https://github.com/imatomix/mixer/tree/main) and [CONTRIBUTING.md](https://github.com/imatomix/mixer/blob/main/CONTRIBUTING.md).
