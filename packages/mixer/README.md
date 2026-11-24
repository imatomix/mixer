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
npm install @imatomix/mixer @imatomix/mix-router
```

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { get, post } from '@imatomix/mix-router'

const app = new Mixer().mix(
  get('/', () => 'Hello mixer'),
  get('/hello/:name', (ctx, { name }) => ({ hello: name })),
  post('/echo', (ctx) => ctx.json()),
)

await serve(app, { port: 3000 })
```

Open http://localhost:3000. On Bun, use `serve` imported from `@imatomix/mixer/bun` instead; see [Running your app](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md) for the other places.

## The basics

### Components

An app is a list of **components**, added with `mix()`. Routes from [mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router) are components, and so are the [modules](#modules) for logging, security headers, CSRF protection, sessions, and the rest:

```ts
import { csrf } from '@imatomix/mix-csrf'
import { logger } from '@imatomix/mix-logger'
import { get } from '@imatomix/mix-router'
import { secureHeaders } from '@imatomix/mix-secure-headers'

app.mix(
  logger(), // modules go first, so they cover every response after them
  secureHeaders(),
  csrf(),
  get('/', () => 'Hello mixer'),
)
```

Components run in the order they were mixed in and **stop at the first one that returns a value** (anything other than `undefined`). If none does, the response is `404`. What `ctx` holds and what a component can return are in the [reference](https://github.com/imatomix/mixer/blob/main/docs/reference/context.md).

### Routes in their own files

Put the routes of one resource in their own file, without the path they are mounted at, and give them a prefix where the app is put together:

```ts
// routes/users.ts
import { get, post } from '@imatomix/mix-router'

export const userRoutes = [
  get('/', () => [{ id: '1', name: 'Alice' }]),
  get('/:id', (ctx, { id }) => ({ id })),
  post('/', async (ctx) => ctx.json()),
]
```

```ts
// app.ts
import { group } from '@imatomix/mix-router'
import { userRoutes } from './routes/users.js'

app.mix(group('/users', userRoutes))
```

### Writing your own component

A component is a function that receives `ctx`. Return nothing to hand over to the next one, return a value to answer, or throw an `HttpError`:

```ts
import { HttpError } from '@imatomix/mixer'

app.mix(
  (ctx) => {
    if (!ctx.request.headers.has('authorization')) throw new HttpError(401)
    // returns nothing: hand over to the next one
  },
  get('/admin', () => 'only with a token'),
)
```

To do something after the rest has built the response, such as adding a header to every response, take `next` as the second argument. Routes and modules do not need it; mixer's modules use it inside:

```ts
app.mix(
  async (ctx, next) => {
    const started = Date.now()
    await next() // runs everything after this component
    ctx.headers.set('X-Response-Time', `${Date.now() - started}ms`)
  },
  get('/', () => 'Hello mixer'),
)
```

See [Composing components with next()](https://github.com/imatomix/mixer/blob/main/docs/explanation/composition.md) for the rules.

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
