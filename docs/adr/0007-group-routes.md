# 0007. Group routes with group(prefix, ...items)

- Status: Accepted
- Date: 2026-11-24

## Context

mix-router put routes under a prefix with `namespace(prefix)`, which returned a function that took the items: `namespace('/todos')(get(...), post(...))`.

When the example app was split into one file per resource, as the code conventions ask, each routes file exported an array, and mounting it read `namespace('/todos')(...todoRoutes(todos))`: two calls in a row and a spread. Other frameworks do the same thing in one call with the prefix first: Express `app.use('/todos', router)`, Hono `app.route('/todos', todos)`, Fastify `register(routes, { prefix })`. The name was unclear as well: `namespace` is also a TypeScript keyword, and it comes from Rails rather than from what JavaScript frameworks use.

## Options

- **Name:** `namespace`, `group` (Elysia, Gin, Echo, Fiber, Laravel), `prefix`, `scope`, or `route` (Hono). `route` is taken by mix-router's `route(methods, path, ...handlers)`.
- **Shape:** the curried form, `group(prefix, ...items)`, or both.

## Decision

`group(prefix, ...items)`, the only form.

- An item is a route, a component, or a readonly array of them, so `group('/todos', todoRoutes(todos))` takes a routes file as it is and `group('/admin', requireAdmin, adminRoutes)` puts a guard first. Arrays are flattened one level when the group is created, in order; an array inside an array is a type error, and an empty array adds nothing.
- Everything else stays as it was: the prefix is matched decoded and segment by segment, `:param` and `*` are rejected, and the items run as one group, so `next()` inside wraps the rest of the group and what follows it.
- `createRouter<S, E>()` returns `group` typed with `S` and `E`, so routes for another state cannot join.
- It matches `mount(prefix, app)`, which takes the prefix first too. `group` gathers routes and components of this app; `mount` hands the prefix to another app.
- `mix()` does not take arrays: a spread there is one `...` in the place an app is put together, and changing mixer's API for symmetry alone is not worth it.

## Consequences

- The curried `namespace` is gone. Nothing was published, so only this repository changed; earlier records keep the old name with a note.
- Routes in their own files mount in one call that reads like the frameworks users know.
