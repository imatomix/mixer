import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { demoUsers, MemoryTodos } from '../src/data.ts'

const ORIGIN = 'http://localhost'

function setup(todos = new MemoryTodos()) {
  return createApp({
    users: demoUsers([
      { id: 'u1', name: 'alice', password: 'alice-pass' },
      { id: 'u2', name: 'bob', password: 'bob-pass' },
    ]),
    todos,
    log: () => {},
  })
}

type App = ReturnType<typeof setup>

/** A frontend on the same origin: keeps cookies like a browser and sends what fetch() sends */
function client(app: App, site = 'same-origin') {
  const jar = new Map<string, string>()

  async function send(method: string, path: string, body?: unknown) {
    const headers = new Headers({ 'sec-fetch-site': site })
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`)
    if (cookie.length > 0) headers.set('cookie', cookie.join('; '))
    if (body !== undefined) headers.set('content-type', 'application/json')
    const res = await app.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';')
      const [name = '', value = ''] = pair.split('=')
      if (/max-age=0/i.test(line)) jar.delete(name)
      else jar.set(name, value)
    }
    return res
  }
  return { send, jar }
}

async function signedIn(app: App, name = 'alice') {
  const user = client(app)
  const res = await user.send('POST', '/api/session', {
    name,
    password: `${name}-pass`,
  })
  expect(res.status).toBe(200)
  return user
}

describe('the JSON API: session', () => {
  it('signs in, tells who is signed in, and signs out', async () => {
    const user = client(setup())
    expect((await user.send('GET', '/api/me')).status).toBe(401)

    const wrong = await user.send('POST', '/api/session', {
      name: 'alice',
      password: 'nope',
    })
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toMatchObject({
      error: 'Wrong name or password',
    })

    const ok = await user.send('POST', '/api/session', {
      name: 'alice',
      password: 'alice-pass',
    })
    expect(await ok.json()).toEqual({ user: { id: 'u1', name: 'alice' } })

    const me = await user.send('GET', '/api/me')
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ user: { id: 'u1', name: 'alice' } })
    expect(me.headers.get('cache-control')).toBe('private, no-store')

    expect((await user.send('DELETE', '/api/session')).status).toBe(204)
    expect((await user.send('GET', '/api/me')).status).toBe(401)
  })

  it('issues a new session ID on sign-in, so a planted ID never becomes the session', async () => {
    const app = setup()
    const attacker = client(app)
    await attacker.send('GET', '/api/me')
    const victim = client(app)
    for (const [name, value] of attacker.jar) victim.jar.set(name, value)
    await victim.send('POST', '/api/session', {
      name: 'alice',
      password: 'alice-pass',
    })
    expect((await attacker.send('GET', '/api/me')).status).toBe(401)
  })

  it('refuses a sign-in posted from another site', async () => {
    const res = await client(setup(), 'cross-site').send(
      'POST',
      '/api/session',
      {
        name: 'alice',
        password: 'alice-pass',
      },
    )
    expect(res.status).toBe(403)
  })
})

describe('the JSON API: todos', () => {
  it('adds, lists, updates, and deletes todos', async () => {
    const user = await signedIn(setup())
    const added = await user.send('POST', '/api/todos', { title: 'Buy milk' })
    expect(added.status).toBe(201)
    const todo = (await added.json()) as { id: string }
    expect(todo).toEqual({ id: todo.id, title: 'Buy milk', done: false })

    expect(await (await user.send('GET', '/api/todos')).json()).toEqual([todo])

    const done = await user.send('PATCH', `/api/todos/${todo.id}`, {
      done: true,
    })
    expect(await done.json()).toEqual({ ...todo, done: true })

    expect((await user.send('DELETE', `/api/todos/${todo.id}`)).status).toBe(
      204,
    )
    expect(await (await user.send('GET', '/api/todos')).json()).toEqual([])
  })

  it('returns what users write as JSON data, for the frontend to escape', async () => {
    const user = await signedIn(setup())
    const title = '<script>alert(1)</script> "x"'
    await user.send('POST', '/api/todos', { title })
    const list = await user.send('GET', '/api/todos')
    expect(list.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(((await list.json()) as { title: string }[])[0]?.title).toBe(title)
  })

  it('answers 422 for an empty or long title and for a body that is not { done }', async () => {
    const user = await signedIn(setup())
    expect((await user.send('POST', '/api/todos', { title: ' ' })).status).toBe(
      422,
    )
    expect(
      (await user.send('POST', '/api/todos', { title: 'x'.repeat(201) }))
        .status,
    ).toBe(422)
    const todo = (await (
      await user.send('POST', '/api/todos', { title: 'a' })
    ).json()) as { id: string }
    expect(
      (await user.send('PATCH', `/api/todos/${todo.id}`, { done: 'yes' }))
        .status,
    ).toBe(422)
  })

  it('never lets one user see or change another user’s todo', async () => {
    const app = setup()
    const alice = await signedIn(app, 'alice')
    const todo = (await (
      await alice.send('POST', '/api/todos', { title: 'Alice only' })
    ).json()) as { id: string }
    const bob = await signedIn(app, 'bob')
    expect(await (await bob.send('GET', '/api/todos')).json()).toEqual([])
    expect(
      (await bob.send('PATCH', `/api/todos/${todo.id}`, { done: true })).status,
    ).toBe(404)
    expect((await bob.send('DELETE', `/api/todos/${todo.id}`)).status).toBe(404)
  })

  it('answers 401 without a session', async () => {
    const res = await client(setup()).send('GET', '/api/todos')
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
  })
})

describe('the JSON API: errors', () => {
  it('answers an unknown API path with a JSON 404', async () => {
    const res = await (await signedIn(setup())).send('GET', '/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Not Found' })
  })

  it('answers a failure with a JSON 500 without details, and the request ID', async () => {
    const failing = new MemoryTodos()
    failing.list = async () => {
      throw new Error('database is down')
    }
    const res = await (await signedIn(setup(failing))).send('GET', '/api/todos')
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; requestId: string }
    expect(body.error).toBe('Something went wrong')
    expect(body.requestId).toBe(res.headers.get('x-request-id'))
    expect(JSON.stringify(body)).not.toContain('database')
  })
})
