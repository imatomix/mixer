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

    get('/:id', (_ctx, { id }) => {
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
