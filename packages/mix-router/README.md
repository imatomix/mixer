# @imatomix/mix-router

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mix-router/README.ja.md)

Type-safe router for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer). Routes are mixer components with parameters typed from the path.

- Runs on Node.js, Bun, and Cloudflare Workers
- At 0.x, so the API may change between minor versions

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-router
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { get, post } from '@imatomix/mix-router'

const app = new Mixer()

app.mix(
  get('/users/:id', (ctx, { id }) => ({ id })), // GET and HEAD /users/42 → { "id": "42" }
  post('/users', async (ctx) => {
    ctx.status = 201
    return await ctx.json()
  }),
)

await serve(app, { port: 3000 })
```

A route is a mixer Component, so it can be passed to `mix()` as is.
When the path or method does not match, it does nothing and hands over to the next component.
Routes match mixer's `ctx.path`, so with `new Mixer({ basePath: '/api' })` you write the paths below `/api`.

## Methods

```ts
get('/route', handler) // GET and HEAD
post('/route', handler)
put('/route', handler)
patch('/route', handler)
del('/route', handler) // DELETE
head('/route', handler)
options('/route', handler)
all('/route', handler) // every method
route(['PROPFIND', 'MKCOL'], '/route', handler) // any method
```

## Path patterns

| Pattern | Matches | params |
| --- | --- | --- |
| `/users` | `/users`, `/users/` | `{}` |
| `/users/:id` | `/users/42` | `{ id: '42' }` |
| `/files/*` | `/files`, `/files/a/b.txt` | `{ '*': 'a/b.txt' }` |

- `*` can only be the last segment of a path
- Parameter names must be valid JavaScript identifiers (such as `:userId`) and cannot repeat within a path. Violations throw at definition
- Literal segments are compared after decoding, so `/ジュース` and `/%E3%82%B8%E3%83%A5%E3%83%BC%E3%82%B9` are the same path
- Each value in params is URL-decoded (`/mix/%E3%82%8A%E3%82%93%E3%81%94` → `{ fruit: 'りんご' }`)
- Read the query with mixer's `ctx.url.searchParams`

### Type inference

The type of params is inferred from the path string. Referring to a parameter that does not exist is a type error.

```ts
get('/users/:userId/posts/:postId', (ctx, params) => {
  params.userId // string
  params.name // type error
})
```

### Safety

- Malformed percent-encoding (such as `/files/%E3%81`) results in `400 Bad Request` (it throws mixer's `HttpError`, so `onError` can replace the response)
- Segments that become `/` or NUL after decoding (such as `/files/..%2F..%2Fetc`) match no route (and end up as mixer's 404)
- Paths with an empty segment in the middle (`//admin/secret`, `/admin//secret`) do not match either. Treating them as `/admin/secret` would disagree with other layers that authorize by a prefix of the raw path (a trailing `/` is ignored)

Dot segments such as `..` are normalized when the URL is parsed.
params is an object without a prototype.

## Multiple handlers

Handlers receive `(ctx, params)` and, as in mixer, **stop at the first one that returns a value**.
Returning `undefined` hands over to the next handler. Plain Components can be used as handlers too.

```ts
import { HttpError } from '@imatomix/mixer'

const requireAuth = (ctx) => {
  if (!ctx.request.headers.has('authorization')) throw new HttpError(401, 'Unauthorized')
}

get('/admin/users/:id', requireAuth, (ctx, { id }) => findUser(id))
```

## 405 Method Not Allowed

By default a path whose method has no route falls through like any other unmatched request and ends as `404`. To answer `405` with an `Allow` header instead, mix `methodNotAllowed()` in after the routes:

```ts
import { get, methodNotAllowed, post } from '@imatomix/mix-router'

app.mix(
  get('/users', listUsers),
  post('/users', createUser),
  methodNotAllowed(), // DELETE /users → 405, Allow: GET, HEAD, POST
)
```

- It answers `405` only when a route's path matched and no route takes the method. A route that takes the method but returns nothing, an `all()` route, or a component in between that answers keeps the usual behavior
- `OPTIONS` is not answered by itself: add an `options()` route, or put [mix-cors](https://github.com/imatomix/mixer/tree/main/packages/mix-cors) before the routes to answer preflights
- **`405` and `Allow` tell the client that a path exists.** If a check such as authentication lives only inside route handlers, put it before the routes instead (for example, as the first component of a [namespace](#components-inside-a-namespace)), so that unauthenticated requests are rejected before anything is revealed

## namespace

Adds a common prefix to routes. Namespaces can be nested.

```ts
import { get, namespace } from '@imatomix/mix-router'

const api = namespace('/api')
const v1 = namespace('/v1')

app.mix(
  api(
    v1(get('/', () => 'API V1')), // GET /api/v1
    get('/health', () => 'ok'), // GET /api/health
  ),
)
```

`:param` and `*` cannot be used in a namespace path,
because those values would not appear in the handlers' params type, and the types would disagree with the actual values.

### Components inside a namespace

A namespace also takes plain components. They run for every request under the prefix, in order with the routes, so an auth check written first protects the whole area, including paths that match no route.

```ts
const admin = namespace('/admin')

app.mix(
  admin(
    requireAuth, // runs for /admin, /admin/users, /admin/unknown, ...
    get('/users', listUsers),
    post('/users', createUser),
  ),
)
```

- The prefix is compared like route paths: after decoding, segment by segment (`/admin` does not cover `/administrator`)
- Components see the full `ctx.path`, not one relative to the namespace
- Order matters as in `mix()`: a component written after a route that answers does not run
- A component inside a namespace can wrap the rest with `await next()`, which runs the rest of the namespace and then what follows it, so it covers only that part of the app:

```ts
api(
  async (ctx, next) => {
    await next()
    if (ctx.error !== undefined) return Response.json({ error: 'Failed' }, { status: ctx.status })
  },
  get('/users', listUsers),
)
```

## mount

Hands a whole app the prefix and everything below it, whatever the method: another mixer app with its own `onError` or `bodyLimit`, or an app built with another framework. Give a mixer app the full path it is mounted at as its `basePath`.

```ts
import { Mixer } from '@imatomix/mixer'
import { mount } from '@imatomix/mix-router'

const admin = new Mixer({ basePath: '/admin' }).mix(/* ... */)

app.mix(
  mount('/admin', admin), // a mixer app
  mount('/legacy', honoApp), // an object with fetch, such as a Hono app with basePath('/legacy')
  mount('/api/auth', auth.handler), // a fetch function
)
```

Calling the app yourself from a route would lose these, which `mount` passes on:

- `ctx.env`, such as the Workers bindings
- `waitUntil`, so the mounted app's background work is not cut off on Workers (its failures are reported by the outer app too)
- the client's address. A mixer app gets the direct peer and applies its own `trustedProxies`, as if it were served directly

What to keep in mind:

- The URL is passed as it is, so the mounted app sees the same URL the client sent. Inside a namespace, its `basePath` includes the namespace: `namespace('/v1')(mount('/admin', app))` needs `basePath: '/v1/admin'`. A wrong `basePath` answers `404`
- The mounted app answers everything under the prefix, its own `404` included, so what is mixed in after `mount` does not run for those paths. What is mixed in before it wraps its responses
- Do not read the request body before `mount`: a body can be read only once, and a read body fails the request with an error saying so
- An error inside the mounted app is answered by its own `onError`. The outer app sees the response, not `ctx.error`, so an outer component that commits work after `next()` should also check `ctx.status`
- A mixer app is recognised with `instanceof Mixer`, so mount apps built with the same copy of `@imatomix/mixer`

## Custom State and Env

`createRouter<State>()` returns a set of route functions with a typed `ctx.state`.

```ts
import { createRouter } from '@imatomix/mix-router'

type AppState = { user?: string }

const { get, post, namespace } = createRouter<AppState>()

const app = new Mixer<AppState>()
app.mix(get('/me', (ctx) => ctx.state.user)) // ctx.state.user: string | undefined
```

Pass the type of `ctx.env` (such as Cloudflare Workers bindings) as the second type argument, the same as for `Mixer`. Without it, `ctx.env` is `unknown`.

```ts
type Env = { DATABASE_URL: string }

const { get } = createRouter<AppState, Env>()

const app = new Mixer<AppState, Env>()
app.mix(get('/db', (ctx) => ctx.env.DATABASE_URL)) // ctx.env.DATABASE_URL: string
```

Routes are created before they are mixed in, so they cannot learn these types from the app; `createRouter` is where you state them once.

