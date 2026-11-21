# @imatomix/mix-cors

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mix-cors/README.ja.md)

CORS for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer).

> **Note:** This package is at 0.x, so the API may change between minor versions.

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-cors
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { cors } from '@imatomix/mix-cors'

const app = new Mixer()

app.mix(cors(), () => 'cors is mixed!')

await app.listen(3000)
```

Mix it in **before** the router and other components.

## Options

```ts
cors({
  origin: ['https://example.com', /^https:\/\/[a-z]+\.example\.com$/],
  credentials: true,
  exposeHeaders: ['X-Total-Count'],
})
```

| Option | Default | Description |
| --- | --- | --- |
| `origin` | `'*'` | Allowed origins: a string, a regular expression, an array of them, or a function `(origin, ctx) => boolean \| Promise<boolean>` |
| `credentials` | `false` | Allow requests with credentials such as cookies |
| `methods` | `['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']` | Methods allowed in preflights |
| `allowHeaders` | The requested headers, as is | Request headers allowed in preflights |
| `exposeHeaders` | none | Response headers that browser JavaScript may read |
| `maxAge` | `600` | Seconds browsers may cache the preflight result (Chrome caps it at 7200) |

### Notes on origin

- Strings are compared exactly. `'https://example.com'` does not match `https://example.com.evil`
- Regular expressions allow an origin **only when they match the whole origin** (they are wrapped in `^(?:…)$` internally). Even `/example\.com/` or `/^a|b$/` do not match `https://example.com.evil`. The `g` / `y` flags are ignored
- With anything other than `'*'`, the matched origin is returned as is, and `Vary: Origin` is added (so caches do not reuse the response for another origin)

### `origin: '*'` cannot be combined with `credentials: true`

Browsers reject this combination. Working around it by echoing the request's origin back would let any site read responses with credentials.
So `cors()` throws as soon as it is called. Specify the allowed origins when you use credentials.

## Behavior

| Request | Behavior |
| --- | --- |
| No `Origin` header (such as same-origin requests) | Moves on without CORS headers (only adds `Vary: Origin` when `origin` is restricted) |
| Preflight (`OPTIONS` + `Origin` + `Access-Control-Request-Method`) | Responds with `204` immediately. Disallowed origins get no CORS headers |
| Anything else | Adds CORS headers for allowed origins and moves on |

- Preflights never reach later components, so the application does not need to handle OPTIONS for them
- `OPTIONS` requests that are not preflights are not intercepted (mix-router's `options()` and similar keep working)
- The headers are kept on error responses from later `HttpError`s (so browsers can read the error)

## Migrating from v0.0.x

| v0.0.x | v0.1 |
| --- | --- |
| `const cors = require('mix-cors')` | `import { cors } from '@imatomix/mix-cors'` |
| `allowCredentials` (default `true`) | `credentials` (default `false`) |
| `allowMethods` | `methods` (`OPTIONS` is no longer needed and was removed from the default) |
| `allowHeaders` (default `['Accept', 'Content-Type']`) | Defaults to allowing the requested headers |
| `maxAge` (default 86400) | Default 600 |
| `origin` accepts strings only | Strings, regular expressions, arrays, and functions |
| Every OPTIONS request treated as a preflight (without responding) | Only real preflights are completed with 204 |
