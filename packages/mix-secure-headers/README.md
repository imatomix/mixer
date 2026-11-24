# @imatomix/mix-secure-headers

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mix-secure-headers/README.ja.md)

Security headers for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer), with defaults that do not break pages and the rest a single option away.

- Runs on Node.js, Bun, and Cloudflare Workers
- At 0.x, so the API may change between minor versions

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-secure-headers
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { secureHeaders } from '@imatomix/mix-secure-headers'

const app = new Mixer()

app.mix(secureHeaders(), () => 'secure headers are mixed!')

await serve(app, { port: 3000 })
```

Mix it in **first**, so the headers reach every response, including `404` and error responses. mixer itself already sends `X-Content-Type-Options: nosniff`.

## Options

```ts
secureHeaders({
  frameOptions: 'SAMEORIGIN',
  hsts: true,
  csp: {
    'default-src': ["'self'"],
    'img-src': ["'self'", 'https://img.example.com'],
    'upgrade-insecure-requests': [],
  },
})
```

| Option | Header | Default | Values |
| --- | --- | --- | --- |
| `frameOptions` | `X-Frame-Options` | `'DENY'` | `'DENY'`, `'SAMEORIGIN'`, `false` |
| `referrerPolicy` | `Referrer-Policy` | `'strict-origin-when-cross-origin'` | Any referrer policy, `false` |
| `hsts` | `Strict-Transport-Security` | off | `true` (one year, `max-age=31536000`), `{ maxAge, includeSubDomains?, preload? }`, `false` |
| `csp` | `Content-Security-Policy` | off | Directives (`{ 'default-src': ["'self'"] }`, one source per item) or the whole header value as a string |
| `crossOriginOpenerPolicy` | `Cross-Origin-Opener-Policy` | off | `'same-origin'`, `'same-origin-allow-popups'`, `'noopener-allow-popups'`, `'unsafe-none'` |
| `crossOriginResourcePolicy` | `Cross-Origin-Resource-Policy` | off | `'same-origin'`, `'same-site'`, `'cross-origin'` |
| `permissionsPolicy` | `Permissions-Policy` | off | The whole header value, such as `'camera=(), geolocation=(self)'` |

Invalid values throw when `secureHeaders()` is called, including CSP sources that contain spaces, `;`, or `,`, which would add directives you did not write.

### Why some headers are off by default

- **`hsts`**: browsers keep it for `maxAge` and it cannot be taken back over HTTP, and it must only be sent over HTTPS. Behind a proxy that handles TLS, mixer cannot tell whether the browser used HTTPS. Turn it on when the site is served over HTTPS only, or let the proxy or CDN that handles TLS send it. `preload` requires `includeSubDomains` and a `maxAge` of at least one year
- **`csp`**: a policy depends on the scripts, styles, and images each app loads
- **`crossOriginOpenerPolicy`**: `same-origin` breaks sign-in and payment popups that talk to the page that opened them
- **`crossOriginResourcePolicy`**: stops other sites from loading your images and files
- **`Referrer-Policy: no-referrer`** is not the default because it makes browsers send `Origin: null` for the site's own form posts, which breaks `Origin` checks such as the one in mix-csrf

Headers that have no effect in current browsers (`X-XSS-Protection`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Permitted-Cross-Domain-Policies`) are not sent.

## Changing headers per route

A header that a later component already set, or that a returned `Response` has, is kept:

```ts
get('/embed', (ctx) => {
  ctx.headers.set('X-Frame-Options', 'SAMEORIGIN')
  return page
})
```

A route can change a value but not remove a header. To let another site show a page in a frame, set a CSP `frame-ancestors` on that route; browsers that understand it ignore `X-Frame-Options`:

```ts
get('/widget', (ctx) => {
  ctx.headers.set('Content-Security-Policy', "frame-ancestors https://partner.example.com")
  return widget
})
```

## How the headers are added

`secureHeaders()` adds the headers after [`await next()`](https://github.com/imatomix/mixer/blob/main/docs/explanation/composition.md), on the response the rest of the app produced, including error responses and the `500` when building a response fails. Mixed in first, nothing can replace the response outside it. The only response without the headers is the `404` for a request outside `basePath`, which is answered before any component runs.
