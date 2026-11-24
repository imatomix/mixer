# mixer

English | [日本語](README.ja.md)

A small web framework built on the Web standard `Request` and `Response`, safe by default, made of parts you pick.

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { csrf } from '@imatomix/mix-csrf'
import { logger } from '@imatomix/mix-logger'
import { get, post } from '@imatomix/mix-router'
import { secureHeaders } from '@imatomix/mix-secure-headers'

const app = new Mixer().mix(
  logger(),
  secureHeaders(),
  csrf(),
  get('/hello/:name', (ctx, { name }) => ({ hello: name })),
  post('/echo', (ctx) => ctx.json()),
)

await serve(app, { port: 3000 })
```

- **Web standard.** `app.fetch(request)` returns a `Response`, so the same app runs on Node.js, Bun, Cloudflare Workers, and inside Next.js, Nuxt, SvelteKit, or React Router
- **Safe by default.** The core gets `nosniff`, cookie attributes, caching of responses with cookies, error responses, body limits, redirects, and host checks right without extra code. CSRF protection and security headers depend on the app, so they are one line each, as above
- **Pick what you need.** The core has no dependencies; routing, CORS, CSRF protection, security headers, static files, sessions, and logging are separate packages, and every part is a plain function you can replace
- **Typed.** Route parameters are inferred from the path, and `ctx.state` and `ctx.env` take your types

## Packages

| Package | Description | Runs on |
| --- | --- | --- |
| [@imatomix/mixer](packages/mixer) | The core: components, `ctx`, responses, cookies, errors, and the Node.js and Bun adapters | Node.js, Bun, Workers |
| [@imatomix/mix-router](packages/mix-router) | Type-safe router | Node.js, Bun, Workers |
| [@imatomix/mix-cors](packages/mix-cors) | CORS | Node.js, Bun, Workers |
| [@imatomix/mix-csrf](packages/mix-csrf) | CSRF protection with `Sec-Fetch-Site` and `Origin` | Node.js, Bun, Workers |
| [@imatomix/mix-secure-headers](packages/mix-secure-headers) | Security headers such as `X-Frame-Options`, HSTS, and CSP | Node.js, Bun, Workers |
| [@imatomix/mix-static](packages/mix-static) | Static files | Node.js, Bun |
| [@imatomix/mix-compress](packages/mix-compress) | Response compression (Brotli, gzip) for apps served directly | Node.js, Bun |
| [@imatomix/mix-session](packages/mix-session) | Server-side sessions | Node.js, Bun, Workers (with an external store) |
| [@imatomix/mix-logger](packages/mix-logger) | Request-scoped logs: request IDs, access logs, and errors tied together | Node.js, Bun, Workers |

Start with the [mixer README](packages/mixer). Supported runtimes: Node.js 24 or later, Bun 1.4.4 or later, and Cloudflare Workers. Every pull request builds and packs the packages as they would be published, and checks them on all three.

> The packages are at 0.x, so the API may change between minor versions.

## Recommended stacks

Components run in the order they are mixed in, and that order is part of the safety. Two starting points:

### An app that serves pages to browsers

```ts
import { Mixer, redirect } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { csrf } from '@imatomix/mix-csrf'
import { type LoggerState, logger } from '@imatomix/mix-logger'
import { createRouter } from '@imatomix/mix-router'
import { secureHeaders } from '@imatomix/mix-secure-headers'
import { type SessionState, session } from '@imatomix/mix-session'
import { serveStatic } from '@imatomix/mix-static'

type State = LoggerState & SessionState<{ userId: string }>
const { get, post } = createRouter<State>()

const app = new Mixer<State>().mix(
  logger(), // first, so every request and error is logged with one ID
  secureHeaders({ csp: { 'default-src': ["'self'"] } }),
  serveStatic('public'), // before session(), so files stay cacheable
  csrf(), // before anything that changes state
  session(), // keeps every signed-in page out of caches
  get('/login', loginPage),
  post('/login', signIn), // call ctx.state.session.regenerate() on success
  (ctx) =>
    ctx.state.session.get('userId') ? undefined : redirect('/login', { status: 303 }),
  get('/', home), // everything from here needs a signed-in user
)

await serve(app, { port: 3000 })
```

- Read forms with `ctx.form()` and check every value; answer a POST with `redirect(path, { status: 303 })`
- mixer does not render HTML: escape everything you put into a page, or use a template library that does
- [examples/todo](examples/todo) is a complete app built this way, with tests, for Node.js, Bun, and Workers

### A JSON API

```ts
import { HttpError, Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { cors } from '@imatomix/mix-cors'
import { type LoggerState, logger } from '@imatomix/mix-logger'
import { createRouter } from '@imatomix/mix-router'

const { post } = createRouter<LoggerState>()

const app = new Mixer<LoggerState>().mix(
  logger(),
  cors({ origin: 'https://app.example.com' }), // only if browsers on other sites call it
  post('/items', async (ctx) => {
    const data = await ctx.json() // 415 unless the body is JSON
    if (typeof data !== 'object' || data === null) throw new HttpError(400)
    // ...check each field before use
    ctx.status = 201
    return data
  }),
)

await serve(app, { port: 3000 })
```

- With tokens in the `Authorization` header, no CSRF protection is needed. If the API is authenticated with cookies, add `csrf()` before the routes, and list in `trustedOrigins` the origins that mix-cors lets send credentials
- On Bun, import `serve` from `@imatomix/mixer/bun`; on Cloudflare Workers, `export default app`

## Development

This repository is a [pnpm](https://pnpm.io/) workspace.

```sh
pnpm install
pnpm check                           # lint, type check, and tests for all packages
pnpm --filter @imatomix/mixer test   # a single package
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute, and [SECURITY.md](SECURITY.md) to report a vulnerability.
