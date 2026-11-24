# Safe by default

English | [日本語](safety.ja.md)

What mixer gets right without extra code, and what it leaves to you.

Without any configuration:

- Every response gets `X-Content-Type-Options: nosniff`
- Cookies are `HttpOnly; Secure; SameSite=Lax; Path=/`. Values are encoded, and names, paths, and domains that could inject headers are rejected
- A response that sets a cookie gets `Cache-Control: private` (unless it already says `private` or `no-store`), so shared caches never hand it to someone else
- Errors other than `HttpError` answer `500` without details. Error responses start from a fresh set of headers, so a `Location`, `Cache-Control`, or cookie meant for the normal response does not leak into the error
- Reading a request body over 3 MB answers `413`, and malformed JSON answers `400`. `ctx.json()` and `ctx.form()` accept only their own Content-Type (`415` otherwise), so a JSON route never parses a cross-site form
- `redirect()` only goes to paths on this site unless you list other origins
- `HEAD` responses and `204` / `205` / `304` carry no body, and a stream that will not be sent is cancelled
- `X-Forwarded-For` is ignored unless you list `trustedProxies`, so a client cannot forge `ctx.ip`
- On Node.js and Bun, `serve()` listens on `127.0.0.1` and accepts only local host names, which stops DNS rebinding (a page on another site reaching your server through a name that resolves to it) and forged `Host` headers

What depends on the app is left to modules, one line each: CSRF protection with [mix-csrf](https://github.com/imatomix/mixer/tree/main/packages/mix-csrf), and `X-Frame-Options`, `Referrer-Policy`, HSTS, or CSP with [mix-secure-headers](https://github.com/imatomix/mixer/tree/main/packages/mix-secure-headers). An app that serves pages to browsers should mix in both.

One more thing mixer cannot decide for you: **do not build absolute URLs from `ctx.url.host`** (for emails or redirects). The client chooses the `Host` header; use an origin from your configuration.
