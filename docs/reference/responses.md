# Responses, errors, and cookies

English | [日本語](responses.ja.md)

What a component can return, how errors become responses, and how cookies are set.

## What a component can return

| Value | Response |
| --- | --- |
| `string` | `text/plain; charset=utf-8` |
| Object, array, number, boolean | JSON (`application/json; charset=utf-8`) |
| `Uint8Array` / `ArrayBuffer` | `application/octet-stream` |
| `Blob` | Its own type, or `application/octet-stream` |
| `ReadableStream` | Streamed (`application/octet-stream`) |
| `null` | No body: `204`, or `ctx.status` if you set one (such as `304`) |
| `Response` | Used as is, with the headers you set added ([details](#returning-a-response)) |

A `Content-Type` you set in `ctx.headers` wins over these defaults.

```ts
app.mix((ctx) => {
  ctx.status = 201
  ctx.headers.set('Location', '/items/1')
  return { created: true }
})
```

## Redirects

```ts
import { redirect } from '@imatomix/mixer'

return redirect('/login') // 302
return redirect('/orders/1', { status: 303 }) // after a form POST
return redirect(ctx.url.searchParams.get('next'), { fallback: '/' }) // a value from the client
return redirect(url, { allowedOrigins: ['https://accounts.example.com'] }) // another site
```

`redirect()` refuses to send users to another site by mistake (an open redirect). By default the location must be a path on this site that starts with a single `/`; `//evil.example`, backslashes, whitespace and control characters, encoded `/` or `\`, `.` and `..` segments, and absolute URLs are rejected with a `TypeError`. For a value that comes from the client, give a `fallback` to use instead. Other sites must be listed in `allowedOrigins` by exact origin. The status is `302` by default (`301`, `303`, `307`, and `308` are accepted), and the path is not prefixed with `basePath`. Cookies set before redirecting are kept.

## Errors

Throw an `HttpError` to answer with its status and `{ "error": message }`. Without a message, it uses the standard reason phrase of the status (`Unauthorized` for `401`, `Too Many Requests` for `429`). Messages of `5xx` errors are never shown. Any other error becomes `500`; its details go to `console.error`, never to the client.

```ts
import { HttpError } from '@imatomix/mixer'

app.mix((ctx) => {
  if (!ctx.request.headers.has('authorization')) throw new HttpError(401)
})
```

Headers an error response needs go on the error itself. Headers and cookies set in `ctx.headers` and `ctx.cookies` before the error are not kept, so that what was meant for a normal response does not leak into the error. A component that must reach error responses too, such as one adding security headers or a session cookie, adds them after `await next()`.

```ts
throw new HttpError(429, 'Too Many Requests', { headers: { 'Retry-After': '60' } })
```

To shape error responses yourself, pass `onError`. It starts with the error's status in `ctx.status`, and what it returns becomes the response. If it returns `undefined` or throws, the default response is sent. `ctx.state` may be incomplete here, because the error can come before the components that fill it, or from a request outside `basePath` that no component saw, so its properties are optional in `onError` (write `ctx.state.log?.requestId`).

```ts
const app = new Mixer({
  onError: (error, ctx) => ({ message: 'Sorry', status: ctx.status }),
})
```

## Error reports

Unexpected errors are logged with `console.error`, together with the request's method and path: errors a component throws (also when `onError` turns them into a response), failures of `onError`, rejected `ctx.waitUntil()` work, and streams that fail to cancel. An `HttpError` below `500` is part of the response, not a failure, so it is not logged.

To send them somewhere else, such as your logger with the request's ID, register `ctx.onErrorReport(fn)`. While at least one listener is registered, mixer stops logging them itself. A listener that throws is logged and does not affect the response. A listener may return a Promise, for example to send the report over the network; the response does not wait for it, and it is kept alive like `ctx.waitUntil()` work.

```ts
app.mix((ctx) => {
  ctx.onErrorReport(({ error, phase }) => {
    myLogger.error({ method: ctx.method, path: ctx.url.pathname, phase, error })
  })
})
```

`phase` is one of `'handling'`, `'onError'`, `'waitUntil'`, `'streamCancel'`, and `'stream'` (an error thrown by an [`sse()`](../how-to/streaming-and-background-work.md#server-sent-events) producer). Mix the listener in first, so errors from every later component reach it. Failures of the Node.js adapter itself, outside any request's handling, are logged by the adapter.

## Returning a Response

A returned `Response` keeps its own status, body, and headers. Headers you set in `ctx.headers` that it does not have are added, `Set-Cookie` headers from both are kept (the `Response` wins for the same cookie), and the `Vary` lists of both are joined. `Response.error()` and a `Response` whose body was already read become `500`.

## Cookies

```ts
ctx.cookies.get('theme') // the first value if the name appears more than once
ctx.cookies.getAll('theme')
ctx.cookies.set('theme', 'dark', { maxAge: 60 * 60 * 24 })
ctx.cookies.delete('theme') // pass the same path / domain used when setting it
```

| Option | Default | Description |
| --- | --- | --- |
| `httpOnly` | `true` | Hide the cookie from JavaScript |
| `secure` | `true` | Send only over HTTPS. Set to `false` when developing on http://localhost |
| `sameSite` | `'Lax'` | `'Strict'` / `'Lax'` / `'None'` |
| `path` | `'/'` | |
| `maxAge` / `expires` / `domain` / `partitioned` / `priority` | none | |

- Setting the same name, path, and domain again in one response replaces the earlier value
- Combinations that browsers reject (such as `SameSite=None` without `Secure`, or `__Host-` with a `Domain`) throw a `TypeError`
- Setting cookies after the response is final throws
