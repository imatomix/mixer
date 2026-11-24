# Signing users in and guarding routes

English | [日本語](auth-and-guards.ja.md)

Check something once before a group of routes, such as a signed-in user, and hand the result to the routes.

## Guarding routes

When a group of routes needs something checked first (a signed-in user, the organization the user belongs to), check it once in a guard and put the result on `ctx.state`. Write the guard first in a [group](https://github.com/imatomix/mixer/blob/main/packages/mix-router/README.md#components-inside-a-group), so it runs for every request under the prefix, including paths that match no route. Routes take the value with a small `requireX(ctx)` helper that throws when it is missing, so a guard that was forgotten or placed after a route fails loudly instead of passing `undefined` on.

A response that depends on who is asking must stay out of shared caches. Set `Cache-Control` in the guard after `await next()`, so it reaches every response under the guard, errors included: `private` keeps shared caches from storing it, and `no-store` keeps any cache from storing it. mixer marks a response private by itself only when it sets a cookie, and mix-session does it for responses with a session; a guard that only reads a value does neither. A response the guard returns before `next()`, such as a redirect, needs its own header if it depends on the request.

For example, signing users in. mixer does not check passwords or talk to identity providers: use an authentication library for that. mixer gives the parts around it (sessions, CSRF protection, secure cookies, the cache policy above) and the guard:

```ts
import { HttpError, redirect } from '@imatomix/mixer'
import { all, createRouter } from '@imatomix/mix-router'

type User = { id: string; name: string }
type State = { user?: User }
const { get, group } = createRouter<State>()

function requireUser(ctx: { state: State }): User {
  if (!ctx.state.user) throw new HttpError(401)
  return ctx.state.user
}

app.mix(
  // A library that takes a Web Request and returns a Response mounts as a route (here, Better Auth)
  all('/api/auth/*', (ctx) => auth.handler(ctx.request)),
  group(
    '/app',
    async (ctx, next) => {
      const result = await auth.api.getSession({ headers: ctx.request.headers })
      if (!result) return redirect('/login', { status: 303 })
      ctx.state.user = result.user
      await next()
      // Pages for one user must not be stored by shared caches
      ctx.headers.set('Cache-Control', 'private, no-store')
    },
    get('/', (ctx) => `hello ${requireUser(ctx).name}`),
  ),
)
```

- Do not read the request body before a route that hands `ctx.request` to a library: a body can be read only once
- A library that keeps its own session cookie does not need mix-session for signing in. With mix-session instead, call `ctx.state.session.regenerate()` when a user signs in
- Libraries built on Node.js `req`/`res` objects (such as Passport) do not run on the Web `Request`/`Response`

Other values follow the same shape: a second guard after this one can look up the organization the signed-in user belongs to, put it on `ctx.state.org`, and routes call `requireOrg(ctx)`.

See [ADR 0002](https://github.com/imatomix/mixer/blob/main/docs/adr/0002-signed-in-user-in-routes.md) for why routes get these values this way.
