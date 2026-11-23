import type { LogEvent } from '@imatomix/mix-logger'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { demoUsers, MemoryTodos } from '../src/data.ts'
import { html } from '../src/html.ts'

const ORIGIN = 'http://localhost'

function setup() {
  const events: LogEvent[] = []
  const app = createApp({
    users: demoUsers([
      { id: 'u1', name: 'alice', password: 'alice-pass' },
      { id: 'u2', name: 'bob', password: 'bob-pass' },
    ]),
    todos: new MemoryTodos(),
    log: (event) => void events.push(event),
  })
  return { app, events }
}

type App = ReturnType<typeof setup>['app']

/** Keeps cookies like a browser and sends the headers a browser adds to a form on the same site */
function browser(app: App) {
  const jar = new Map<string, string>()

  async function send(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`)
    if (cookie.length > 0) headers.set('cookie', cookie.join('; '))
    const res = await app.fetch(
      new Request(new URL(path, ORIGIN), { ...init, headers }),
    )
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';')
      const [name = '', value = ''] = pair.split('=')
      if (/Max-Age=0/i.test(line)) jar.delete(name)
      else jar.set(name, value)
    }
    return res
  }

  return {
    jar,
    get: (path: string) =>
      send(path, { headers: { 'sec-fetch-site': 'same-origin' } }),
    post: (
      path: string,
      fields: Record<string, string> = {},
      site = 'same-origin',
    ) =>
      send(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'sec-fetch-site': site,
          origin: ORIGIN,
        },
        body: new URLSearchParams(fields).toString(),
      }),
  }
}

async function signedIn(app: App, name = 'alice') {
  const user = browser(app)
  const res = await user.post('/login', { name, password: `${name}-pass` })
  expect(res.status).toBe(303)
  return user
}

async function todoIds(user: ReturnType<typeof browser>) {
  const page = await (await user.get('/')).text()
  return [...page.matchAll(/action="\/todos\/([^/]+)\/toggle"/g)].map(
    (match) => match[1] ?? '',
  )
}

describe('signing in', () => {
  it.each(['/', '/missing'])(
    'sends signed-out visitors of %s to the login page',
    async (path) => {
      const res = await browser(setup().app).get(path)
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe('/login')
    },
  )

  it('lets anyone cache the login page, but never a signed-in page', async () => {
    const { app } = setup()
    const login = await browser(app).get('/login')
    expect(login.headers.get('cache-control')).toBeNull()
    const list = await (await signedIn(app)).get('/')
    expect(list.headers.get('cache-control')).toBe('private, no-store')
  })

  it('shows the login form', async () => {
    const res = await browser(setup().app).get('/login')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toContain('<form method="post" action="/login">')
  })

  it('rejects a wrong password without creating a session', async () => {
    const user = browser(setup().app)
    const res = await user.post('/login', { name: 'alice', password: 'nope' })
    expect(res.status).toBe(401)
    expect(await res.text()).toContain('Wrong name or password')
    expect(user.jar.size).toBe(0)
  })

  it("issues a new session ID on login, so an attacker's planted ID never becomes the victim's session", async () => {
    const { app } = setup()
    const attacker = await signedIn(app, 'bob')
    const planted = attacker.jar.get('__Host-sid') ?? ''

    const victim = browser(app)
    victim.jar.set('__Host-sid', planted)
    await victim.post('/login', { name: 'alice', password: 'alice-pass' })
    expect(victim.jar.get('__Host-sid')).not.toBe(planted)
    expect(await (await victim.get('/')).text()).toContain('alice')

    // The planted ID is gone, so the attacker holds nothing of alice's
    expect((await attacker.get('/')).status).toBe(303)
  })

  it('ends the session on logout', async () => {
    const { app } = setup()
    const user = await signedIn(app)
    const oldId = user.jar.get('__Host-sid') ?? ''
    const res = await user.post('/logout')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/login')
    expect((await user.get('/')).status).toBe(303)

    const replay = browser(app)
    replay.jar.set('__Host-sid', oldId)
    expect((await replay.get('/')).status).toBe(303)
  })
})

describe('todos', () => {
  it('adds, toggles, and deletes a todo with forms, answering each POST with 303', async () => {
    const user = await signedIn(setup().app)
    const added = await user.post('/todos', { title: 'Buy milk' })
    expect(added.status).toBe(303)
    expect(added.headers.get('location')).toBe('/')
    expect(await (await user.get('/')).text()).toContain('Buy milk')

    const [id = ''] = await todoIds(user)
    expect((await user.post(`/todos/${id}/toggle`)).status).toBe(303)
    expect(await (await user.get('/')).text()).toContain('class="done"')

    expect((await user.post(`/todos/${id}/delete`)).status).toBe(303)
    expect(await (await user.get('/')).text()).not.toContain('Buy milk')
  })

  it('escapes what users write', async () => {
    const user = await signedIn(setup().app)
    await user.post('/todos', { title: '<script>alert(1)</script> "x"' })
    const page = await (await user.get('/')).text()
    expect(page).not.toContain('<script>alert(1)</script>')
    expect(page).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot;',
    )
  })

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['too long', 'x'.repeat(201)],
  ])('refuses a title that is %s with 422', async (_label, title) => {
    const user = await signedIn(setup().app)
    const res = await user.post('/todos', { title })
    expect(res.status).toBe(422)
    expect(await res.text()).toContain('between 1 and 200 characters')
  })

  it("never lets one user see or change another user's todo", async () => {
    const { app } = setup()
    const alice = await signedIn(app, 'alice')
    await alice.post('/todos', { title: 'Alice only' })
    const [id = ''] = await todoIds(alice)

    const bob = await signedIn(app, 'bob')
    expect(await (await bob.get('/')).text()).not.toContain('Alice only')
    expect((await bob.post(`/todos/${id}/toggle`)).status).toBe(404)
    expect((await bob.post(`/todos/${id}/delete`)).status).toBe(404)
    expect(await (await alice.get('/')).text()).toContain('Alice only')
  })

  it('requires a session for changes', async () => {
    const res = await browser(setup().app).post('/todos', { title: 'x' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/login')
  })
})

describe('protection', () => {
  it.each(['/todos', '/logout', '/login'])(
    'rejects a cross-site POST to %s',
    async (path) => {
      const { app } = setup()
      const user = await signedIn(app)
      const res = await user.post(path, { title: 'x' }, 'cross-site')
      expect(res.status).toBe(403)
    },
  )

  it('sends security headers, a CSP, and no-store on every page, including errors', async () => {
    const { app } = setup()
    const user = await signedIn(app)
    for (const res of [
      await user.get('/'),
      await user.get('/missing'),
      await user.post('/todos', { title: '' }),
    ]) {
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      expect(res.headers.get('content-security-policy')).toContain(
        "default-src 'self'",
      )
      expect(res.headers.get('cache-control')).toBe('private, no-store')
      expect(res.headers.get('x-request-id')).toBeTruthy()
    }
  })
})

describe('errors', () => {
  it('shows signed-in users an HTML 404 page with the request ID', async () => {
    const res = await (await signedIn(setup().app)).get('/missing')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toContain(res.headers.get('x-request-id') ?? '-')
  })

  it('answers a form without a field with an HTML 400 page', async () => {
    const res = await browser(setup().app).post('/login', { name: 'alice' })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain(
      'The form field &quot;password&quot; is missing',
    )
  })

  it('answers JSON sent to a form route with an HTML 415 page', async () => {
    const res = await setup().app.fetch(
      new Request(`${ORIGIN}/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
        },
        body: '{"name": "alice"}',
      }),
    )
    expect(res.status).toBe(415)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
  })

  it('shows an HTML 500 page without details and logs the error with the same ID', async () => {
    const events: LogEvent[] = []
    const failing = new MemoryTodos()
    failing.list = async () => {
      throw new Error('database is down')
    }
    const app = createApp({
      users: demoUsers([{ id: 'u1', name: 'alice', password: 'alice-pass' }]),
      todos: failing,
      log: (event) => void events.push(event),
    })
    const user = await signedIn(app)
    const res = await user.get('/')
    expect(res.status).toBe(500)
    const page = await res.text()
    expect(page).not.toContain('database is down')
    const id = res.headers.get('x-request-id') ?? '-'
    expect(page).toContain(id)
    expect(
      events
        .filter((event) => event.requestId === id)
        .map((event) => event.kind),
    ).toEqual(['error', 'access'])
  })
})

describe('logs', () => {
  it('ties what a request logged to one ID', async () => {
    const { app, events } = setup()
    const user = browser(app)
    const res = await user.post('/login', {
      name: 'alice',
      password: 'alice-pass',
    })
    const id = res.headers.get('x-request-id')
    const mine = events.filter((event) => event.requestId === id)
    expect(mine.map((event) => event.kind)).toEqual(['app', 'access'])
    expect(mine[0]).toMatchObject({
      message: 'signed in',
      fields: { userId: 'u1' },
    })
  })
})

describe('html', () => {
  it('escapes interpolated values and keeps nested markup', () => {
    const inner = html`<b>${'<i>'}</b>`
    expect(String(html`<p title="${'"x"'}">${inner}${['&', null]}</p>`)).toBe(
      '<p title="&quot;x&quot;"><b>&lt;i&gt;</b>&amp;</p>',
    )
  })
})
