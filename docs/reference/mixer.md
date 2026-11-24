# Mixer

English | [日本語](mixer.ja.md)

The options of `new Mixer()`, mounting under a path, the client's address, and typing the app.

## Types

```ts
type State = { user?: string }
type Env = { DATABASE_URL: string }

const app = new Mixer<State, Env>()
// ctx.state.user: string | undefined, ctx.env.DATABASE_URL: string
```

## Client IP address

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

## basePath

```ts
const app = new Mixer({ basePath: '/api' })
// GET /api/users → ctx.path === '/users'; requests outside /api get 404
```

`ctx.url` keeps the full URL. Modules route on `ctx.path`, so they work under `basePath` unchanged.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `basePath` | none | Path the app is mounted on |
| `bodyLimit` | 3 MB | Largest request body that `ctx.json()`, `ctx.form()`, `ctx.text()`, and `ctx.bytes()` read; larger ones answer `413`. A read can pass its own `bodyLimit` for one route ([details](../how-to/request-body.md#request-body)) |
| `onError` | none | `(error, ctx) => value` to shape error responses |
| `trustedProxies` | none | Reverse proxies (IP addresses or CIDR ranges) whose `X-Forwarded-For` is read for `ctx.ip` |
