# JSON API

[English](json-api.md) | 日本語

投稿を作る・一覧する・読む API。入力は [Zod](https://zod.dev/) のスキーマで確かめる。1 つのリソースのルートは前置きのパスを書かずに書き、`namespace` で載せる。

```ts
// examples/docs/src/json-api.ts

import { get, namespace, post } from '@imatomix/mix-router'
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

  return new Mixer().mix(namespace('/api/posts')(...postRoutes))
}
```

- `validateInput()` は JSON の本文とクエリ文字列を型付きの値にし、合わなければ `422` を返す。`z.strictObject` はスキーマにないキー（`__proto__` など）を拒む
- `ctx.json()` は `application/json` だけを受け付け（それ以外は `415`）、壊れた JSON には `400` を返す
- 見つからない投稿は `HttpError(404)` で、`{ "error": "Not Found" }` を返す
- 動かすには `@imatomix/mixer/node` の `serve(createApp(), { port: 3000 })`、Cloudflare Workers なら `export default createApp()`。テストは [examples/docs/test/json-api.test.ts](../../examples/docs/test/json-api.test.ts)

関連: [リクエストボディを読んで確かめる](../how-to/request-body.ja.md)、[アプリをテストする](../how-to/testing.ja.md)
