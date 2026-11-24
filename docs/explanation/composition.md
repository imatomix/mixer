# Composing components with next()

English | [日本語](composition.ja.md)

How components wrap the ones after them. Why it works this way: [ADR 0001](../adr/0001-compose-components-with-next.md).

A component receives `next` as its second argument. `await next()` runs the components after it and resolves to the `Response` they produced; it never throws, because an error below has already been turned into the error response (through `onError` or the default), and the error is kept in `ctx.error`.

```ts
app.mix(
  async (ctx, next) => {
    await db.begin()
    await next()
    // A thrown error is in ctx.error; a 500 a handler returns on purpose is not an error
    if (ctx.error === undefined) await db.commit()
    else await db.rollback()
  },
  post('/orders', createOrder),
)
```

The rules:

- After `await next()`, `ctx.headers`, `ctx.cookies`, and `ctx.status` are those of the response it returned, so headers and cookies are added the same way as before. Use `ctx.headers` again after `next()`: a reference taken before it still points at the old draft
- After `next()`, return nothing to keep the response, or return a whole new `Response`. Returning any other value answers `500`, because it would go out with the old response's `Content-Type` and `Content-Length`
- Call `next()` once and await it. Calling it twice or after returning, or returning while the rest is still running, answers `500`
- **Put components whose headers or cookies must reach every response first**, such as mix-logger, mix-secure-headers, mix-cors, and mix-session. A component placed outside them that replaces the response would drop what they added
- mixer's own guarantees (`nosniff`, private caching of responses with cookies, no body for `HEAD`, `204`, and `304`) are applied after every component, so no component can undo them

Two things the rules do not cover: keep `next()` inside the component that received it (calling it from another request runs the original request's components), and a component that throws loses what it would have added, since its error response is built outside it. Keep functions that modules call, such as mix-cors's `origin` or mix-logger's `requestId`, from throwing.

`compose(...components)` runs a list as one group by the same rules: `next()` inside runs the rest of the group, then what follows it. mix-router's `group` is built on it, so a component inside a group wraps only that part of the app, such as JSON error pages under `/api`.
