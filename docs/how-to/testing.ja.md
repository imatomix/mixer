# アプリをテストする

[English](testing.md) | 日本語

mixer のアプリは `Request` を受けて `Response` を返す関数なので、テストからそのまま呼べる。サーバーもポートも要らず、テストはクライアントが受け取るのと同じ `Response` を見る。例は [Vitest](https://vitest.dev/) で書いているが、`node:test` や `bun test` でも同じように書ける。

## アプリを関数で作る

アプリを関数の中で組み立てると、テストごとに新しいアプリを作り、必要なものを渡せる。

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

サーバーを起動する入口（`serve(createApp(), { port: 3000 })`）は別のファイルに置き、テストからは読み込まない。

## リクエストを送る

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

URL のホスト名は `app.fetch` には関係しない。ホスト名を確かめるのは `serve()` だけ。

## リクエストをまたいでセッションを保つ

テストがブラウザの役をする。ある応答から Cookie を取り出し、次のリクエストに付けて送る。

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

mix-csrf は、`Sec-Fetch-Site` も `Origin` もないリクエストを、ブラウザ以外のクライアントからのものとして通す。別のサイトからのフォームが拒否されることを確かめるには、ブラウザが送るものを付ける: `headers: { 'sec-fetch-site': 'cross-site' }`。

## 環境と応答のあとの処理を渡す

`app.fetch` は Cloudflare Workers と同じ引数を受け取るので、テストからバインディングを渡したり、`ctx.waitUntil()` に渡された処理を集めたりできる。

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

`ctx.ip` に値を入れるには、`app.fetch` の代わりに `app.handle(request, { remoteAddress: '203.0.113.7' })` を呼ぶ。

## 本物のサーバーが要るとき

要るのは、Node.js や Bun のアダプターそのものを確かめるときや、`new Request()` が正規化してしまう生のパス（`/../x` など）を送るときくらい。ポート `0` で空いているポートを使い、テストのあとでサーバーを閉じる。

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
