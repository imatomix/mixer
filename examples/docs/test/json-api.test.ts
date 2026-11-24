import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/json-api.ts'

let app: ReturnType<typeof createApp>

beforeEach(() => {
  app = createApp()
})

const send = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://localhost${path}`, init))

const create = (body: unknown) =>
  send('/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('the JSON API example', () => {
  it('creates a post and lists it', async () => {
    const created = await create({ title: 'Hello', body: 'First post' })
    expect(created.status).toBe(201)
    const post = (await created.json()) as { id: string }
    expect(created.headers.get('location')).toBe(`/api/posts/${post.id}`)

    const list = await send('/api/posts')
    expect(await list.json()).toEqual([post])
    expect(await (await send(`/api/posts/${post.id}`)).json()).toEqual(post)
  })

  it('pages the list with limit and offset', async () => {
    for (const title of ['a', 'b', 'c']) await create({ title, body: '' })
    const page = (await (await send('/api/posts?limit=1&offset=1')).json()) as {
      title: string
    }[]
    expect(page.map((post) => post.title)).toEqual(['b'])
  })

  it('answers 422 for invalid input and 404 for an unknown post', async () => {
    expect((await create({ title: '' })).status).toBe(422)
    expect((await create({ title: 'x', body: '', admin: true })).status).toBe(
      422,
    )
    expect((await send('/api/posts?limit=1000')).status).toBe(422)
    expect((await send('/api/posts/nope')).status).toBe(404)
  })
})
