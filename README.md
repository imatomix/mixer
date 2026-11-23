# mixer

English | [日本語](README.ja.md)

A small web framework built on the Web standard `Request` and `Response`, safe by default, made of parts you pick.

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { cors } from '@imatomix/mix-cors'
import { logger } from '@imatomix/mix-logger'
import { get, post } from '@imatomix/mix-router'

const app = new Mixer().mix(
  logger(),
  cors({ origin: 'https://example.com' }),
  get('/hello/:name', (ctx, { name }) => ({ hello: name })),
  post('/echo', (ctx) => ctx.body()),
)

await serve(app, { port: 3000 })
```

- **Web standard.** `app.fetch(request)` returns a `Response`, so the same app runs on Node.js, Bun, Cloudflare Workers, and inside Next.js, Nuxt, SvelteKit, or React Router
- **Safe by default.** Security headers, cookie attributes, caching of responses with cookies, error responses, and host checks are right without extra code
- **Pick what you need.** The core has no dependencies; routing, CORS, CSRF protection, static files, sessions, and logging are separate packages, and every part is a plain function you can replace
- **Typed.** Route parameters are inferred from the path, and `ctx.state` and `ctx.env` take your types

## Packages

| Package | Description | Runs on |
| --- | --- | --- |
| [@imatomix/mixer](packages/mixer) | The core: components, `ctx`, responses, cookies, errors, and the Node.js adapter | Node.js, Bun, Workers |
| [@imatomix/mix-router](packages/mix-router) | Type-safe router | Node.js, Bun, Workers |
| [@imatomix/mix-cors](packages/mix-cors) | CORS | Node.js, Bun, Workers |
| [@imatomix/mix-csrf](packages/mix-csrf) | CSRF protection with `Sec-Fetch-Site` and `Origin` | Node.js, Bun, Workers |
| [@imatomix/mix-static](packages/mix-static) | Static files | Node.js, Bun |
| [@imatomix/mix-session](packages/mix-session) | Server-side sessions | Node.js, Bun, Workers (with an external store) |
| [@imatomix/mix-logger](packages/mix-logger) | Access logs | Node.js, Bun, Workers |

Start with the [mixer README](packages/mixer). Supported runtimes: Node.js 24 or later, Bun 1.4.4 or later, and Cloudflare Workers. Every pull request builds and packs the packages as they would be published, and checks them on all three.

> The packages are at 0.x, so the API may change between minor versions.

## Development

This repository is a [pnpm](https://pnpm.io/) workspace.

```sh
pnpm install
pnpm check                           # lint, type check, and tests for all packages
pnpm --filter @imatomix/mixer test   # a single package
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute, and [SECURITY.md](SECURITY.md) to report a vulnerability.
