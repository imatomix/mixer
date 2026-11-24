# Testing your app

English | [日本語](testing.ja.md)

A mixer app is a function from a `Request` to a `Response`, so a test calls it directly: no server, no port, and the test sees the same `Response` a client gets. The examples use [Vitest](https://vitest.dev/); `node:test` and `bun test` work the same way.

## Make the app in a function

Build the app in a function, so each test gets a fresh one with what it needs passed in:

```ts
// src/app.ts
import { Mixer } from '@imatomix/mixer'
import { get, post } from '@imatomix/mix-router'

export function createApp() {
  return new Mixer().mix(
    get('/hello/:name', (ctx, { name }) => ({ hello: name })),
    post('/echo', (ctx) => ctx.json()),
  )
}
```

The entry point that starts the server (`serve(createApp(), { port: 3000 })`) stays in its own file, which tests do not import.

## Send a request

```ts
// test/app.test.ts
import { expect, it } from 'vitest'
import { createApp } from '../src/app.js'

const app = createApp()

it('greets by name', async () => {
  const res = await app.fetch(new Request('http://localhost/hello/mixer'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ hello: 'mixer' })
})

it('echoes a JSON body', async () => {
  const res = await app.fetch(
    new Request('http://localhost/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    }),
  )
  expect(await res.json()).toEqual({ a: 1 })
})
```

The host in the URL does not matter to `app.fetch`; only `serve()` checks it.

## Keep a session across requests

A test is the browser: take the cookie from one response and send it with the next request.

```ts
// test/session.test.ts
import { Mixer } from '@imatomix/mixer'
import { get, post } from '@imatomix/mix-router'
import { type SessionState, session } from '@imatomix/mix-session'
import { expect, it } from 'vitest'

const app = new Mixer<SessionState<{ user: string }>>().mix(
  session<{ user: string }>(),
  post('/login', (ctx) => {
    ctx.state.session.regenerate()
    ctx.state.session.set('user', 'alice')
    return 'ok'
  }),
  get('/me', (ctx) => ctx.state.session.get('user') ?? null),
)

it('remembers the user after signing in', async () => {
  const login = await app.fetch(
    new Request('http://localhost/login', { method: 'POST' }),
  )
  const cookie = login.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ')

  const me = await app.fetch(
    new Request('http://localhost/me', { headers: { cookie } }),
  )
  expect(await me.text()).toBe('alice')
})
```

With mix-csrf, a request without `Sec-Fetch-Site` and `Origin` passes, as from any client that is not a browser. To check that a cross-site form is refused, send what a browser would: `headers: { 'sec-fetch-site': 'cross-site' }`.

## Pass the environment and background work

`app.fetch` takes the same arguments as on Cloudflare Workers, so a test can hand in bindings and collect the work passed to `ctx.waitUntil()`:

```ts
// test/env.test.ts
import { Mixer } from '@imatomix/mixer'
import { expect, it } from 'vitest'

type Env = { GREETING: string }

const app = new Mixer<Record<string, unknown>, Env>().mix((ctx) => {
  ctx.waitUntil(Promise.resolve('sent'))
  return ctx.env.GREETING
})

it('uses the environment and runs background work', async () => {
  const work: Promise<unknown>[] = []
  const res = await app.fetch(
    new Request('http://localhost/'),
    { GREETING: 'hi' },
    { waitUntil: (promise) => void work.push(promise) },
  )
  expect(await res.text()).toBe('hi')
  await Promise.all(work)
  expect(work).toHaveLength(1)
})
```

To give `ctx.ip` a value, call `app.handle(request, { remoteAddress: '203.0.113.7' })` instead of `app.fetch`.

## When a real server is needed

Only a few things need one: the Node.js or Bun adapter itself, or a raw path that `new Request()` would normalize (such as `/../x`). Listen on port `0` for a free port, and close the server after the test:

```ts
// test/server.test.ts
import { serve } from '@imatomix/mixer/node'
import { expect, it } from 'vitest'
import { createApp } from '../src/app.js'

it('answers over HTTP', async () => {
  const server = await serve(createApp())
  try {
    const res = await fetch(`http://localhost:${server.port}/hello/mixer`)
    expect(await res.json()).toEqual({ hello: 'mixer' })
  } finally {
    await server.close()
  }
})
```
