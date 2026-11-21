# mixer

[English](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.md) | 日本語

Minimal & asynchronous web module. Web 標準の `Request` / `Response` で動く。

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

- TypeScript 製・ESM のみ・依存ゼロ
- Node.js 24 以上、Bun 1.4.4 以上、または Cloudflare Workers
- `app.fetch(request)` は Web 標準のハンドラそのものなので、Next.js・Nuxt・SvelteKit・React Router などのフレームワークの中でも動く
- 何もしなくても安全側: すべての応答に `X-Content-Type-Options: nosniff`、Cookie は `HttpOnly; Secure; SameSite=Lax`、Cookie を付けた応答は共有キャッシュに残さない、エラーの詳細はクライアントに見せない

## Install

```sh
npm install @imatomix/mixer
```

## Usage

リクエストを受け取ったときに実行する関数（コンポーネント）を `mix()` で足していく。
コンポーネントは `ctx` を 1 つ受け取り、値を返すとそれがレスポンスになる。

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'

const app = new Mixer().mix(() => 'Hello Mixer')

await serve(app, { port: 3000 })
```

Bun では `app.fetch` を `Bun.serve` に渡す。

```ts
Bun.serve({ port: 3000, fetch: app.fetch })
```

### mix()

関数は個別に `mix()` で繋げてもいいし、一つの `mix()` に複数入れてもいい。

```ts
app.mix(fn).mix(fn).mix(fn)
app.mix(fn, fn, fn)
```

先に `mix()` した順に実行され、**値を返した（`undefined` 以外）ところで止まる**。
何も返さなければ次のコンポーネントへ進み、最後まで誰も応答しなければ `404` になる。

### ctx

| プロパティ | 説明 |
| --- | --- |
| `ctx.request` | Web 標準の `Request` |
| `ctx.url` | リクエスト URL の `URL` オブジェクト（`ctx.url.pathname`, `ctx.url.searchParams`） |
| `ctx.path` | `basePath`（後述）を除いたパス。ルーティングにはこれを使う |
| `ctx.method` | HTTP メソッド |
| `ctx.status` | レスポンスのステータス（デフォルト `200`） |
| `ctx.headers` | レスポンスのヘッダ（`Headers` オブジェクト） |
| `ctx.state` | 後続のコンポーネントに値を渡すための入れ物 |
| `ctx.env` | `app.fetch` の第 2 引数（サーバーレス環境のバインディングなど） |
| `await ctx.body()` | Content-Type に応じて解析したボディ |
| `await ctx.text()` / `await ctx.bytes()` | ボディを文字列 / `Uint8Array` で取得 |
| `ctx.cookies` | Cookie の読み取りと Set-Cookie の追加（後述） |
| `ctx.onBeforeSend(fn)` | レスポンスを組み立てる直前に実行する処理を登録する（後述） |
| `ctx.onResponse(fn)` | レスポンスができたあとに実行する処理を登録する（後述） |
| `ctx.waitUntil(promise)` | 応答を待たせずに、応答のあとで処理を実行する（後述） |

`ctx.status` と `ctx.headers` はレスポンスの下書き。mixer は下書きと戻り値から、`Response` を 1 回だけ組み立てる。

### レスポンス

戻り値の型で形式が決まる。先に `ctx.headers` で `Content-Type` を設定していればそちらが優先される。

| 値 | レスポンス |
| --- | --- |
| `string` | `text/plain; charset=utf-8` |
| `Uint8Array` / `ArrayBuffer` | `application/octet-stream` |
| `Blob` | Blob 自身の type、なければ `application/octet-stream` |
| `ReadableStream` | そのままストリーミング（`application/octet-stream`） |
| オブジェクト・数値・真偽値 | JSON（`application/json; charset=utf-8`） |
| `null` | `204 No Content`（`304` など `ctx.status` を設定していればそのステータス） |
| `Response` | そのまま使い、下書きと合わせる（後述） |

```ts
app.mix((ctx) => {
  ctx.status = 201
  ctx.headers.set('Location', '/items/1')
  return { created: true }
})
```

返した `Response` は、自身のステータス・本文・ヘッダを保つ。`Response` にない下書きのヘッダは足され、`Set-Cookie` は両方残り（同じ Cookie は `Response` 側が優先）、`Vary` は両方の値を合わせる。
`Response.error()` と、本文を読み終えた `Response` は `500` になる。

すべての応答に `X-Content-Type-Options: nosniff` が付く。Cookie を付けた応答は、すでに `private` か `no-store` でなければ `Cache-Control: private` になる。`HEAD` の応答と `204` / `205` / `304` には本文が付かない。

### ctx.onBeforeSend()

レスポンスを組み立てる直前に実行する処理を登録する。登録順に実行され、`ctx.status`・`ctx.headers`・Cookie を変更できる。
後続のコンポーネントが変更した状態（セッションの Cookie など）を最後に反映したいときに使う。

```ts
app
  .mix((ctx) => {
    ctx.onBeforeSend(() => {
      ctx.headers.set('X-User', ctx.state.user ?? 'guest')
    })
  })
  .mix((ctx) => {
    ctx.state.user = 'imatomix'
    return 'ok'
  })
```

- `404` やエラーを含め、すべての応答で 1 回だけ実行される
- フックが例外を投げると `500` になる（フックは再実行されない）

### ctx.onResponse()

最終的なレスポンスができたあとに実行する処理（ログなど）を登録する。フックはスナップショット `{ status, headers }` を受け取る。変更しても応答には影響しない。
フックは `app.fetch` が返る前に実行されるので、短く保ち、時間のかかる処理は `ctx.waitUntil()` に渡す。フックの失敗はログに出るだけで、応答には影響しない。

```ts
app.mix((ctx) => {
  ctx.onResponse(({ status }) => {
    ctx.waitUntil(sendMetrics(ctx.path, status))
  })
})
```

### ctx.waitUntil()

応答を待たせずに、応答のあとで処理を実行する。処理が最後まで続くかどうかは、動かす場所で決まる。

- **動き続けるサーバー**（`serve()`、`Bun.serve`）: プロセスが動き続けるので、処理は最後まで実行される。失敗は `console.error` に出す
- **応答のあとで止まりうる環境**（サーバーレス関数など）: その環境の、応答後の処理を登録する API を `app.fetch(request, env, { waitUntil })` のように第 3 引数で渡す。渡さないと mixer は環境に処理を伝えられず、途中で打ち切られることがある

### ctx.cookies

```ts
ctx.cookies.get('theme') // 同名が複数あれば最初の値
ctx.cookies.getAll('theme')
ctx.cookies.set('theme', 'dark', { maxAge: 60 * 60 * 24 })
ctx.cookies.delete('theme') // 設定時と同じ path / domain を渡す
```

| オプション | デフォルト | 説明 |
| --- | --- | --- |
| `httpOnly` | `true` | JavaScript から読めなくする |
| `secure` | `true` | HTTPS のときだけ送る。http://localhost で開発するときは `false` に |
| `sameSite` | `'Lax'` | `'Strict'` / `'Lax'` / `'None'` |
| `path` | `'/'` | |
| `maxAge` / `expires` / `domain` / `partitioned` / `priority` | なし | |

- 値は送るときに URL エンコードされ、読むときにデコードされる
- 1 つの応答で同じ name・path・domain を設定し直すと、前の値を置き換える。ほかの方法で足した Set-Cookie はそのまま残る
- ヘッダを注入できる name・path・domain や、ブラウザが拒否する組み合わせ（Secure なしの `SameSite=None`、Domain 付きの `__Host-` など）は `TypeError` を投げる
- 応答が確定したあとの `set` / `delete` は例外を投げる

### リクエストボディ

`ctx.body()` は必要になったときだけボディを読み、何度呼んでも同じ結果を返す。

| Content-Type | 結果 |
| --- | --- |
| `application/json`, `*+json` | `JSON.parse` した値（不正なら `400`） |
| `application/x-www-form-urlencoded` | `{ key: value }`（同じキーは配列） |
| `text/*` または指定なし | 文字列 |
| それ以外 | `Uint8Array` |
| 空のボディ | `undefined` |

上限（デフォルト 3 MB）を超えると `413` になる。

```ts
const app = new Mixer({ bodyLimit: 1024 * 1024 })
```

### basePath

アプリをあるパスの下に置く。その外へのリクエストは `404` になり、`ctx.path` はその下のパスになる（`ctx.url` は URL 全体のまま）。

```ts
const app = new Mixer({ basePath: '/api' })
// GET /api/users → ctx.path === '/users'
```

### ctx.state・ctx.env と型

```ts
type State = { user?: string }
type Env = { DATABASE_URL: string }

const app = new Mixer<State, Env>()

app
  .mix((ctx) => {
    ctx.state.user = 'imatomix'
  })
  .mix((ctx) => `hello ${ctx.state.user}`)
```

### エラー処理

`HttpError` を投げると、そのステータスと `{ "error": message }` で応答する（ステータスは 400〜599）。
それ以外のエラーは `500` になり、詳細はクライアントに見せず `console.error` に出す。

```ts
import { HttpError, Mixer } from '@imatomix/mixer'

app.mix((ctx) => {
  if (!ctx.state.user) throw new HttpError(401, 'Unauthorized')
})
```

エラーの応答は新しい下書きから作る。引き継ぐのは `Access-Control-*`・`Vary`・`Set-Cookie` だけなので、通常の応答のための `Location` や `Cache-Control` がエラーの応答に紛れ込まない。

エラーの応答は `onError` で差し替えられる。`ctx.status` にエラーのステータスが入った状態で呼ばれ、戻り値がレスポンスになる。`undefined` を返すか例外を投げると、デフォルトの応答になる。

```ts
const app = new Mixer({
  onError: (error, ctx) => ({ message: 'Sorry', status: ctx.status }),
})
```

## アプリを動かす

### Node.js

`@imatomix/mixer/node` の `serve` で、Node の `http` モジュールの上で動かす。

```ts
import { serve } from '@imatomix/mixer/node'

const server = await serve(app, { port: 3000 })
server.port // 使っているポート（port: 0 なら空いているポート）
await server.close()
```

**何もしなくても安全側:**

- `hostname` を渡さなければ `127.0.0.1`（このマシンだけ）で待ち受ける
- 受け付けるホスト名は `localhost`、`*.localhost`、`127.0.0.1`、`[::1]`、`hostname` に渡した IP アドレスだけ。それ以外のホスト名へのリクエストは本文なしの `400` になってアプリに届かず、最初の 1 回だけ `console.warn` に出る。DNS リバインディング（別のサイトのページが、自分のサーバーを指す名前を使って話しかけてくる攻撃）と、偽の `Host` ヘッダを防ぐ

ドメインで公開するときや、ほかのマシンから使うとき（コンテナなど）は、明示する。

```ts
await serve(app, {
  port: 3000,
  hostname: '0.0.0.0', // ほかのマシンからの接続も受け付ける
  allowedHosts: ['example.com', 'www.example.com'], // 完全一致。大文字小文字とポートは無視する
})
```

`allowedHosts: true` はどのホスト名も受け付ける。アプリの手前（リバースプロキシなど）でホスト名を確かめている場合だけに使う。`X-Forwarded-*` ヘッダは使わない。

- リクエストの URL は `Host` ヘッダから作る。`Host` がない、複数ある、単純なホスト名とポート以外のものは `400` になる
- メールやリダイレクトに使う**絶対 URL は、設定したオリジンから作る**。`ctx.url.host` は使わない。`allowedHosts` があっても、一覧の中のどれを送るかはクライアントが選べる
- コンポーネントがリクエストボディを読まなかったとき（`413` のあとなど）は、残りを読まずに接続を閉じる
- クライアントが切断すると `ctx.request.signal` が中断され、ストリーミング中の本文も止まる

### Bun

```ts
Bun.serve({ port: 3000, fetch: app.fetch })
```

`Bun.serve` はホスト名を確かめない。上の確認は `@imatomix/mixer/node` の `serve()` のもの。Bun で開発用のサーバーを動かすときは `hostname: '127.0.0.1'` を渡し、`ctx.url.host` を信用しない。

### Cloudflare Workers

`Mixer` はそのまま Workers のハンドラになる。default export で書き出す。

```ts
import { Mixer } from '@imatomix/mixer'

type Env = { DATABASE_URL: string }

const app = new Mixer<Record<string, unknown>, Env>().mix((ctx) => ctx.env.DATABASE_URL)

export default app satisfies ExportedHandler<Env>
```

- `ctx.env` には Worker のバインディングが入り、`ctx.waitUntil()` は Worker の `ctx.waitUntil` に渡される。mix-router を使うときは、`createRouter<State, Env>()` にもバインディングの型を渡す
- PR ごとに、workerd の互換日付 `2026-07-30`、Node 互換を切った状態（`no_nodejs_compat`、`no_nodejs_compat_v2`）で動作を確かめ、`@cloudflare/workers-types` で型も確かめている。mixer に `nodejs_compat` は要らない

| パッケージ | Workers での扱い |
| --- | --- |
| `@imatomix/mixer`、mix-router、mix-cors、mix-logger | 対応 |
| mix-session | 外部のストアを使えば対応（`MemoryStore` は 1 つの isolate の中にしかなく、リクエストは別の isolate で動きうる） |
| mix-static | 非対応（ファイルシステムがない）。静的ファイルは Workers Static Assets で配る |
| `@imatomix/mixer/node` | 使わない（Node.js 専用） |

注意:

- ここでも**ホスト名は信頼できない**。絶対 URL は `ctx.url.host` からではなく、設定したオリジンから作る
- `bodyLimit` が効くのは、`ctx.body()`・`ctx.text()`・`ctx.bytes()` で本文を読んだときだけ。`ctx.request` を直接読むと効かない
- `ctx.waitUntil()` に渡した処理には、Workers の時間の上限がかかる

### フレームワークの中で使う

`app.fetch` は `Request` を受け取って `Response` を返すので、フレームワークで作ったアプリの一部を受け持てる。置いた場所のパスを `basePath` に設定する。
渡すのは `Request` だけにする。フレームワークはハンドラにほかの引数も渡すので、そのまま渡すと `ctx.env` に入ってしまう。

**Next.js**（App Router）、`app/api/[[...path]]/route.ts`:

```ts
const app = new Mixer({ basePath: '/api' }).mix(/* ... */)
const handler = (request: Request) => app.fetch(request)

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE }
```

**Nuxt**（Nuxt 4、h3 v1）、`server/api/[...path].ts`:

```ts
const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export default defineEventHandler((event) => app.fetch(toWebRequest(event)))
```

h3 v2 では、すでに `Request` である `event.req` を渡す。

**SvelteKit**、`src/routes/api/[...path]/+server.ts`:

```ts
import type { RequestHandler } from './$types'

const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export const fallback: RequestHandler = ({ request }) => app.fetch(request)
```

**React Router**（v7、フレームワークモード）、`app/routes/api.$.ts` などのリソースルート:

```ts
import type { Route } from './+types/api.$'

const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export const loader = ({ request }: Route.LoaderArgs) => app.fetch(request)
export const action = ({ request }: Route.ActionArgs) => app.fetch(request)
```

# Examples

### async/await

```ts
const app = new Mixer().mix(async () => {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  return 'Good Morning Mixer'
})
```

### ストリーミング

```ts
app.mix(() => {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      for (const word of ['mix', 'and', 'match']) {
        controller.enqueue(encoder.encode(`${word}\n`))
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      controller.close()
    },
  })
})
```

## v0.1 からの移行

| v0.1 | v0.2 |
| --- | --- |
| `await app.listen(3000)` | `@imatomix/mixer/node` の `await serve(app, { port: 3000 })` |
| `app.close()`、`app.address` | `server.close()`、`server.port` |
| `listen()` は全てのネットワークで待ち受け、どの `Host` も受け付ける | `serve()` は `127.0.0.1` で待ち受け、ローカルのホスト名だけを受け付ける。ほかは `hostname` と `allowedHosts` で渡す |
| `app.handler`（`(req, res)`） | `app.fetch`（`(request) => Response`） |
| `ctx.req` | `ctx.request`（Web 標準の `Request`） |
| `ctx.req.headers.origin` | `ctx.request.headers.get('origin')` |
| `ctx.res.setHeader(name, value)` | `ctx.headers.set(name, value)` |
| `ctx.send(status, body)` | `ctx.status = status; return body` または `return new Response(body, { status })` |
| `ctx.res` に直接書く | `ReadableStream` か `Response` を返す |
| `await ctx.buffer()`（`Buffer`） | `await ctx.bytes()`（`Uint8Array`） |
| Node の `Readable` を返す | `ReadableStream` を返す（`Readable.toWeb(stream)`） |
| `onError: (error, ctx) => ctx.send(...)` | `onError: (error, ctx) => value` |
| `ctx.url.pathname` でルーティング | `ctx.path` でルーティング（`basePath` に対応） |

## Modules

必要なものだけ選んで使う。

- [@imatomix/mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router): 型安全なルーター
- [@imatomix/mix-cors](https://github.com/imatomix/mixer/tree/main/packages/mix-cors): CORS
- [@imatomix/mix-static](https://github.com/imatomix/mixer/tree/main/packages/mix-static): 静的ファイル配信
- [@imatomix/mix-session](https://github.com/imatomix/mixer/tree/main/packages/mix-session): サーバサイドセッション
- [@imatomix/mix-logger](https://github.com/imatomix/mixer/tree/main/packages/mix-logger): アクセスログ

## Development

[リポジトリのルート](https://github.com/imatomix/mixer/tree/main)で `pnpm check` を実行する。詳しくは [CONTRIBUTING.md](https://github.com/imatomix/mixer/blob/main/CONTRIBUTING.md) を参照。
