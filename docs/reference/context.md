# ctx

English | [日本語](context.ja.md)

What a component receives as its first argument.

## ctx

| Property | Description |
| --- | --- |
| `ctx.request` | The Web standard `Request` |
| `ctx.url` | The request URL as a `URL` (`ctx.url.searchParams` for the query) |
| `ctx.path` | The path without `basePath`. Route on this |
| `ctx.method` | The HTTP method |
| `ctx.status` / `ctx.headers` | Status (default `200`) and headers of the response being built |
| `ctx.state` | Values passed to later components |
| `ctx.env` | Bindings and settings passed as the second argument of `app.fetch` |
| `ctx.ip` / `ctx.remoteAddress` | The client's IP address, and the direct peer's ([details](mixer.md#client-ip-address)) |
| `await ctx.json()` / `await ctx.form()` | The request body as JSON, or as `FormData` from a form or file upload ([details](../how-to/request-body.md#request-body)) |
| `await ctx.text()` / `await ctx.bytes()` | The request body as a string or bytes |
| `ctx.cookies` | Read cookies and set them on the response ([details](responses.md#cookies)) |
| `ctx.error` | After `await next()`, the error a later component threw, if any ([details](../explanation/composition.md)) |
| `ctx.onErrorReport(fn)` | Receive unexpected errors for this request ([details](responses.md#error-reports)) |
| `ctx.waitUntil(promise)` | Run work after the response without delaying it ([details](../how-to/streaming-and-background-work.md#ctxwaituntil)) |
