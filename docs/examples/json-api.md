# A JSON API

English | [日本語](json-api.ja.md)

Create, list, and read posts, with the input checked by a [Zod](https://zod.dev/) schema. The routes of one resource are written without their prefix and mounted with `group`.

```ts
// examples/docs/src/json-api.ts

import { get, group, post } from '@imatomix/mix-router'
import { HttpError, Mixer, validateInput } from '@imatomix/mixer'
import { z } from 'zod'

const NewPost = z.strictObject({
  title: z.string().min(1).max(100),
  body: z.string().max(10_000),
})

const Page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

type Post = z.infer<typeof NewPost> & { id: string }

export function createApp() {
  const posts = new Map<string, Post>()

  const postRoutes = [
    get('/', async (ctx) => {
      const query = Object.fromEntries(ctx.url.searchParams)
      const { limit, offset } = await validateInput(Page, query)
      return [...posts.values()].slice(offset, offset + limit)
    }),

    get('/:id', (ctx, { id }) => {
      const found = posts.get(id)
      if (!found) throw new HttpError(404)
      return found
    }),

    post('/', async (ctx) => {
      const input = await validateInput(NewPost, await ctx.json())
      const created: Post = { id: crypto.randomUUID(), ...input }
      posts.set(created.id, created)
      ctx.status = 201
      ctx.headers.set('Location', `/api/posts/${created.id}`)
      return created
    }),
  ]

  return new Mixer().mix(group('/api/posts', postRoutes))
}
```

- `validateInput()` turns the JSON body and the query string into typed values, and answers `422` when they do not match. `z.strictObject` rejects keys the schema does not know, such as `__proto__`
- `ctx.json()` accepts only `application/json` (`415` otherwise) and answers `400` for broken JSON
- A missing post is an `HttpError(404)`; `{ "error": "Not Found" }` is sent for it
- Run it with `serve(createApp(), { port: 3000 })` from `@imatomix/mixer/node`, or `export default createApp()` on Cloudflare Workers. The tests are in [examples/docs/test/json-api.test.ts](../../examples/docs/test/json-api.test.ts)

See also: [Reading and validating the request body](../how-to/request-body.md), [Testing your app](../how-to/testing.md).
