# @imatomix/mix-csrf

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mix-csrf/README.ja.md)

CSRF protection for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer), using the `Sec-Fetch-Site` and `Origin` headers browsers send. No tokens, no session, no configuration.

- Runs on Node.js, Bun, and Cloudflare Workers
- At 0.x, so the API may change between minor versions

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-csrf
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { csrf } from '@imatomix/mix-csrf'
import { post } from '@imatomix/mix-router'

const app = new Mixer()

app.mix(
  csrf(),
  post('/transfer', (ctx) => 'only your own pages can send this'),
)

await serve(app, { port: 3000 })
```

Mix it in **before** the router, sessions, and anything that changes state. A request a browser sent from another site gets `403` and never reaches later components.

## Options

```ts
csrf({
  trustedOrigins: ['https://admin.example.com'],
  allow: (ctx) => ctx.url.pathname.startsWith('/webhooks/'),
})
```

| Option | Default | Description |
| --- | --- | --- |
| `trustedOrigins` | none | Other origins allowed to send requests. Write them exactly as browsers send `Origin`: `https://admin.example.com`, with no path or trailing slash, and a port only when it is not the default. Wildcards are not supported. Anything else throws when `csrf()` is called |
| `allow` | none | `(ctx) => boolean \| Promise<boolean>`. Requests for which it returns `true` are not checked, such as webhooks that other services send |

When mix-cors lets another site send requests with cookies (`credentials: true`), list those origins in `trustedOrigins` too.

## Behavior

`GET`, `HEAD`, and `OPTIONS` are not checked. Every other method is checked, whatever its `Content-Type`.

| Request | Result |
| --- | --- |
| `Sec-Fetch-Site: same-origin` or `none` (the user typed the URL or used a bookmark) | Passes |
| `Sec-Fetch-Site: same-site`, `cross-site`, or anything else | `403`, unless `Origin` is in `trustedOrigins` |
| No `Sec-Fetch-Site`, and `Origin` has the same host and port as the request | Passes |
| No `Sec-Fetch-Site`, and any other `Origin` (including `null`) | `403`, unless it is in `trustedOrigins` |
| Neither header | Passes, as a client other than a browser (curl, another server) |

- `same-site` is rejected, so a page on another subdomain of your site cannot send requests either
- Clients other than browsers send neither header. They cannot carry a user's cookies to your app, so they are not a CSRF risk. Endpoints that need more than CSRF protection should authenticate those clients
- Rejections are an `HttpError(403)`, so `onError` and your error handling see them like any other error

## Limits

- Keep `GET` and `HEAD` free of side effects. They are never checked
- Browsers released before 2023 do not send `Sec-Fetch-Site`, and for them only the host of `Origin` is compared, not the scheme. Serve the site over HTTPS only (with `Strict-Transport-Security`) so that a page on `http://` of the same host cannot exist
- Behind a reverse proxy, the proxy must pass the original `Host` header. If it rewrites it, browsers without `Sec-Fetch-Site` get `403`
- Proxies or privacy extensions that strip both headers make a browser look like a non-browser client. For actions where that matters, also require an authenticated token or a re-entered password

The approach follows Go's [`http.CrossOriginProtection`](https://pkg.go.dev/net/http#CrossOriginProtection) and the [OWASP guidance on Fetch Metadata](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
