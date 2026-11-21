# @imatomix/mix-router

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mix-router/README.ja.md)

Type-safe router for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer).

> **Note:** This package is at 0.x, so the API may change between minor versions.

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-router
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { all, get } from '@imatomix/mix-router'

const app = new Mixer()

app.mix(
  get('/mix/:fruit', (ctx, { fruit }) => `${fruit} juice`),
  all('/*', () => new Response('Not found route', { status: 404 })),
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

## Custom State

`createRouter<State>()` returns a set of route functions with a typed `ctx.state`.

```ts
import { createRouter } from '@imatomix/mix-router'

type AppState = { user?: string }

const { get, post, namespace } = createRouter<AppState>()

const app = new Mixer<AppState>()
app.mix(get('/me', (ctx) => ctx.state.user)) // ctx.state.user: string | undefined
```

## Migrating from v0.1

The router API is unchanged. Follow [mixer's migration table](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.md#migrating-from-v01) for the handlers:

- Routes match `ctx.path` instead of `ctx.url.pathname`, so they work under `basePath`
- Instead of `ctx.send(status, body)`, return a value (after setting `ctx.status`) or a `Response`
- The request path is decoded once per request, however many routes there are

## Migrating from v0.0.x

| v0.0.x | v0.1 |
| --- | --- |
| `const { get } = require('mix-router')` | `import { get } from '@imatomix/mix-router'` |
| `get(path, (req, res) => {})` | `get(path, (ctx, params) => {})` |
| `req.params.fruit` | `params.fruit` from the second argument |
| `req.query.q` | `ctx.url.searchParams.get('q')` |
| `namespace(prefix)(...routes)` | Same (paths are now joined correctly when nested) |
| Other methods such as `mkcalendar()` | `route('MKCALENDAR', path, handler)` |
| `res.post(200, x)` | `return x` |
