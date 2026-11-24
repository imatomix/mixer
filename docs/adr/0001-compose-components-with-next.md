# 0001. Compose components with next()

- Status: Accepted
- Date: 2026-11-24

## Context

Until now a component ran in order and either returned a value (the response) or `undefined` (go on). Work around the response was registered as hooks:

- `ctx.onBeforeSend`: asynchronous work right before the response is built; a failure answers 500
- `ctx.onResponseHeaders`: synchronous header edits on the response actually sent; a failure drops the edit
- `ctx.onResponse`: observing the final response; a failure is only reported
- `ctx.onErrorReport`: receiving unexpected errors

What we saw while building the modules and the example app:

- Each new need added a hook. The last two came within a week, for request-scoped logging and for headers that every response needs.
- One concern spread over several places. mix-session loaded the session in a component, saved it in `onBeforeSend`, and set its cache policy in `onResponseHeaders`.
- Each hook had its own rules about timing and failure, so writing a module meant learning all of them.
- The core needed a special case: error responses kept `Access-Control-*`, `Vary`, and `Set-Cookie` from before the error, only because modules could not touch error responses themselves.
- Some things could not be written at all: transforming a response body (such as compression), handling errors for one group of routes, or committing a transaction only when the request succeeded.

The criteria for this decision: simple and secure, and fixing something or adding a feature later must not make things more complicated.

## Options

1. Keep components and hooks, and add hooks when needed.
2. Keep components and hooks, and add `next()` as a reserve for what hooks cannot do.
3. Make `next()` the only way to wrap: one component form `(ctx, next)`, and no hooks around the response.

Option 2 was rejected first. It would freeze a second way to compose, with its own rules, while removing none of the hooks, so there would be more to learn, not less.

## What we tried

We built option 3 on a branch, replacing the hooks in the core and rewriting mix-session, mix-logger, mix-secure-headers, and mix-cors as components that wrap the rest with `next()`.

- **The example app** (`examples/todo`) passed all 24 of its tests without changing a line: sign-in, CSRF, security headers, cache policy, error pages, and log correlation.
- **The modules** kept their tests: router 65 (61 existing plus 4 for groups), csrf 34, static 97, cors 29, logger 38, session 96. mix-secure-headers kept 32 of 33; the one lost behavior is described below. Module sizes stayed about the same, but each concern now reads top to bottom in one place.
- **The core** got smaller: core and modules together changed by +189 −265 lines, and the error-response special case was no longer needed, because CORS and the session now add their headers and cookies after `next()`, on error responses too.
- **Performance** on the same stack (logger, security headers, CSRF, session, one route) through `app.fetch`: 10.3 µs per request with hooks, 7.8 µs with `next()`; 20 nested wrappers took 8.1 µs.
- **Runtimes**: the packed packages and the example app's browser flow passed on Node.js, Bun, and workerd.
- **Two reviews** of the branch found problems, all fixed and covered by tests: a cookie set before and after `next()` was sent twice; a failing `onError` let the original error's headers (such as `WWW-Authenticate`) into the 500; changing the status to 204 after `next()` failed instead of dropping the body; a body piped into a new one was reported as a cancel failure; a kept `next()` could be called after the component returned.
- **What it showed about ordering**: a component that never runs adds nothing in either model, so placing it too late is the same mistake as before. What is new is that a component that replaces the response, placed outside another, discards the headers and cookies the inner one added.

## Decision

Components are composed with `next()`, and it is the only way to wrap the rest.

1. A component is `(ctx, next) => value | undefined`. Returning a value answers; returning `undefined` goes on.
2. `await next()` runs the components after this one and resolves to the Response they produced. It never rejects: an error below is turned into the error response (through `onError` or the default) and kept in `ctx.error`.
3. After `next()` resolves, `ctx.headers`, `ctx.cookies`, and `ctx.status` refer to that Response, so headers and cookies are added after `next()` the same way as before it.
4. After `next()`, a component returns nothing (keeping the Response) or a whole new `Response`. Any other value is a programming error and answers 500, because it would be sent with the replaced response's `Content-Type` and `Content-Length`.
5. `next()` may be called once and must be awaited before the component returns. Calling it twice, after returning, or without awaiting it answers 500.
6. Error responses start from fresh headers, plus the headers of an `HttpError`. Nothing set before the error carries over; components that must reach error responses add their headers and cookies after `next()`.
7. `compose(...components)` runs a list as one group by the same rules: `next()` inside runs the rest of the group, then what follows it. mix-router's `namespace` is built on it, so `next()` works inside namespaces.
8. The core still applies its own guarantees outside every component: `nosniff`, private caching of responses with cookies, and no body for `HEAD`, 204, and 304.
9. `ctx.onBeforeSend`, `ctx.onResponseHeaders`, and `ctx.onResponse` are removed. `ctx.onErrorReport` and `ctx.waitUntil` stay, because `ctx.error` holds one error and cannot show failures after the response, such as a rejected `waitUntil` or a failing `onError`.

The line for what the core guards: it prevents what would silently break safety or data. Misuse fails loudly with a 500 rather than being made to work, and harmless mistakes are left to documentation.

## Consequences

- One mechanism replaces three hooks, and a module reads as one sequence. Body transforms, error handling for a group of routes, and transactions (rolling back when `ctx.error` is set) can now be written as components.
- **Order matters for guarantees owned by modules.** Components whose headers or cookies must reach every response (security headers, CORS, session, logger) go first, so nothing outside them can replace the response. The README shows this order.
- A route can no longer remove a header that mix-secure-headers adds after `next()`; it can change the value. To let another site embed a page, the route sets a CSP `frame-ancestors`. Removal is not supported.
- A reference to `ctx.headers` taken before `next()` still points at the old draft; use `ctx.headers` again after `next()`.
- This is a breaking change to the component signature and removes three hooks. It is made before the first release.
