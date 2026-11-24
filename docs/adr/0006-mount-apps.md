# 0006. Mount whole apps with mount()

- Status: Accepted
- Date: 2026-11-24

## Context

`namespace(prefix)` groups routes and components of one app under a prefix. Some parts of an app are whole apps instead: a mixer app with its own `onError` or `bodyLimit`, an app written with another framework, or one that is distributed as a package. The only way to put one in was to call it from a route, `all('/admin/*', (ctx) => admin.fetch(ctx.request))`, which quietly loses three things:

- `ctx.env`, so the mounted app does not get the Workers bindings
- `waitUntil`, so on Workers its background work can be cut off after the response
- the client's address, so a mounted mixer app sees no `ctx.ip`

## Options

1. **A.** No API; document what to pass.
2. **B.** `mount(prefix, app)` in mix-router: matches the prefix like a namespace and hands every request under it, whatever the method, to the app with the environment, `waitUntil`, and the address. The URL is passed as it is, and the mounted app keeps its own `basePath`.
3. **C.** B, and rewrite the URL to strip the prefix, as some frameworks do.

## What we found

- Rewriting the URL changes what the mounted app sees as its own address: redirects it builds, signed URLs, cookie paths, and the request's signal and body all have to be carried over to a new `Request`. Keeping the URL and a matching `basePath` is what the mixer README already advises for running inside other frameworks.
- Passing `ctx.ip` as an already resolved client address would skip the mounted app's own `trustedProxies`. Passing the direct peer (`remoteAddress`) lets the mounted app decide, as if it were served directly; `ctx.ip` is passed only when there is no peer address (a platform that resolved it).
- Telling a mixer app apart by a `handle` method would also treat unknown objects as mixer apps; `instanceof Mixer` does not.

## Decision

Use B: `mount(prefix, app)`, where `app` is a `Mixer`, an object with `fetch`, or a fetch function.

- The prefix and everything below it are matched like a namespace (decoded, segment by segment), for every method, so `methodNotAllowed()` does not answer for them.
- A `Mixer` is called with `handle(request, { env, executionContext, remoteAddress, clientIp })`; any other app with `(request, env, { waitUntil })`. `waitUntil` goes through `ctx.waitUntil()`, so failures are reported by the outer app too.
- A request whose body the outer app has already read fails with an error that says so, instead of a mounted app that cannot read it.
- The mounted app's `basePath` must be the full path it is mounted at (the outer `basePath` and every enclosing namespace included). A mismatch answers `404`, which shows at once, so it is documented rather than checked.

## Consequences

- No new API in mixer; mix-router gains `mount`.
- The mounted app answers everything under its prefix, its own `404` included; outer components after `mount` do not run for those paths, and outer components before it wrap its responses.
- An error inside the mounted app is answered by its own `onError`. The outer app sees only the response, not `ctx.error`, so outer components that commit work on success should also check the status.
