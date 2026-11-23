# @imatomix/mixer

[English](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.md) | 日本語

Web 標準の `Request` / `Response` で動く、小さな Web フレームワーク。アプリを関数の並びとして書くと、mixer がその戻り値を安全な応答にする。

- **Web 標準。** `app.fetch(request)` は `Request` を受け取って `Response` を返すので、同じアプリが Node.js・Bun・Cloudflare Workers で動き、Next.js・Nuxt・SvelteKit・React Router の中でも動く
- **何もしなくても安全。** セキュリティのためのヘッダ、Cookie の属性、Cookie を含む応答のキャッシュ、エラーの応答が、追加のコードなしで正しくなる（[後述](#何もしなくても安全)）
- **必要なものだけ選べる。** ルーティング・CORS・静的ファイル・セッション・ログは[別のモジュール](#モジュール)で、どれも差し替えられる
- TypeScript 製・ESM のみ・依存ゼロ。Node.js 24 以上、Bun 1.4.4 以上、または Cloudflare Workers

> mixer は 0.x なので、マイナーバージョンの間で API が変わることがある。

## すぐ始める

```sh
npm install @imatomix/mixer
```

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'

const app = new Mixer().mix(() => 'Hello mixer')

await serve(app, { port: 3000 })
```

http://localhost:3000 を開く。Bun では代わりに `Bun.serve({ port: 3000, fetch: (request) => app.fetch(request) })` を使う。ほかの動かし方は[アプリを動かす](#アプリを動かす)を参照。

## 基本

### コンポーネント

アプリは**コンポーネント**の並び。コンポーネントは `ctx` を受け取り、応答を返すこともある関数で、`mix()` で足していく。

```ts
app.mix(
  (ctx) => {
    ctx.state.startedAt = Date.now() // 何も返さない: 次へ進む
  },
  (ctx) => {
    if (ctx.path === '/hello') return { hello: 'mixer' } // 値を返す: これが応答になる
  },
)
```

コンポーネントは `mix()` した順に実行され、**値（`undefined` 以外）を返したところで止まる**。どれも返さなければ `404` になる。ルーティングもコンポーネントの一つ。[mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router) を参照。

### ctx

| プロパティ | 説明 |
| --- | --- |
| `ctx.request` | Web 標準の `Request` |
| `ctx.url` | リクエストの URL（`URL`。クエリは `ctx.url.searchParams`） |
| `ctx.path` | `basePath` を除いたパス。ルーティングにはこれを使う |
| `ctx.method` | HTTP メソッド |
| `ctx.status` / `ctx.headers` | 組み立て中の応答のステータス（既定 `200`）とヘッダ |
| `ctx.state` | 後のコンポーネントに渡す値 |
| `ctx.env` | `app.fetch` の第 2 引数で渡すバインディングや設定 |
| `ctx.ip` / `ctx.remoteAddress` | クライアントの IP アドレスと、直接の接続元の IP アドレス（[詳細](#クライアントの-ip-アドレス)） |
| `await ctx.body()` | Content-Type に応じて解析したリクエストボディ。フォームとファイルのアップロードも含む（[詳細](#リクエストボディ)） |
| `await ctx.text()` / `await ctx.bytes()` | ボディを文字列 / `Uint8Array` で |
| `ctx.cookies` | Cookie を読み、応答に付ける（[詳細](#cookie)） |
| `ctx.onBeforeSend(fn)` / `ctx.onResponse(fn)` | 応答の前後のフック（[詳細](#フック)） |
| `ctx.waitUntil(promise)` | 応答を待たせずに、応答のあとで処理する（[詳細](#ctxwaituntil)） |

### 返せる値

| 値 | 応答 |
| --- | --- |
| `string` | `text/plain; charset=utf-8` |
| オブジェクト・配列・数値・真偽値 | JSON（`application/json; charset=utf-8`） |
| `Uint8Array` / `ArrayBuffer` | `application/octet-stream` |
| `Blob` | Blob 自身の type、なければ `application/octet-stream` |
| `ReadableStream` | ストリーミング（`application/octet-stream`） |
| `null` | 本文なし: `204`、または設定した `ctx.status`（`304` など） |
| `Response` | そのまま使い、設定したヘッダを足す（[詳細](#response-を返す)） |

`ctx.headers` で設定した `Content-Type` は、これらの既定より優先される。

```ts
app.mix((ctx) => {
  ctx.status = 201
  ctx.headers.set('Location', '/items/1')
  return { created: true }
})
```

### リダイレクト

```ts
import { redirect } from '@imatomix/mixer'

return redirect('/login') // 302
return redirect('/orders/1', { status: 303 }) // フォームを POST した後
return redirect(ctx.url.searchParams.get('next'), { fallback: '/' }) // クライアントから受け取った値
return redirect(url, { allowedOrigins: ['https://accounts.example.com'] }) // ほかのサイト
```

`redirect()` は、うっかり利用者をほかのサイトへ送ってしまうこと（オープンリダイレクト）を防ぐ。既定では、`/` 1 つで始まるこのサイトのパスだけを受け付け、`//evil.example`、`\`、空白・制御文字、符号化された `/` や `\`、`.` と `..` の区切り、絶対 URL は `TypeError` で拒否する。クライアントから受け取った値には、代わりに使う `fallback` を渡す。ほかのサイトへは、`allowedOrigins` にオリジンを完全一致で並べたものだけ。ステータスは既定で `302`（`301`・`303`・`307`・`308` も可）で、パスに `basePath` は付け足さない。リダイレクトの前に設定した Cookie は残る。

### エラー

`HttpError` を投げると、そのステータスと `{ "error": message }` で応答する。それ以外のエラーは `500` になり、詳細は `console.error` に出してクライアントには見せない。

```ts
import { HttpError } from '@imatomix/mixer'

app.mix((ctx) => {
  if (!ctx.request.headers.has('authorization')) throw new HttpError(401, 'Unauthorized')
})
```

エラーの応答に必要なヘッダは、エラー自身に持たせる。エラーの前に `ctx.headers` で設定したヘッダは（`Access-Control-*`・`Vary`・`Set-Cookie` を除き）引き継がれない。通常の応答のためのヘッダがエラーに紛れ込まないようにするため。

```ts
throw new HttpError(429, 'Too Many Requests', { headers: { 'Retry-After': '60' } })
```

エラーの応答を自分で組み立てるときは `onError` を渡す。`ctx.status` にエラーのステータスが入った状態で呼ばれ、戻り値が応答になる。`undefined` を返すか例外を投げると、既定の応答になる。

```ts
const app = new Mixer({
  onError: (error, ctx) => ({ message: 'Sorry', status: ctx.status }),
})
```

### 型

```ts
type State = { user?: string }
type Env = { DATABASE_URL: string }

const app = new Mixer<State, Env>()
// ctx.state.user: string | undefined、ctx.env.DATABASE_URL: string
```

## アプリを動かす

`app.fetch` はただの `(request, env?, executionContext?) => Promise<Response>` なので、どこで動かす場合も、リクエストをこれに渡すだけ。

### Node.js

```ts
import { serve } from '@imatomix/mixer/node'

const server = await serve(app, { port: 3000 })
server.port // 使っているポート（port: 0 なら空いているポート）
await server.close()
```

`serve()` は、指定しなければ `127.0.0.1` で待ち受け、ローカルのホスト名だけを受け付ける（[理由](#何もしなくても安全)）。ドメインで公開するときや、コンテナなどほかのマシンから使うときは明示する。

```ts
await serve(app, {
  port: 3000,
  hostname: '0.0.0.0', // ほかのマシンからの接続も受け付ける
  allowedHosts: ['example.com', 'www.example.com'],
})
```

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `port` | `0`（空いているポート） | |
| `hostname` | `'127.0.0.1'` | 待ち受けるアドレス |
| `allowedHosts` | なし | `localhost`・`*.localhost`・`127.0.0.1`・`[::1]`・`hostname` に渡した IP アドレスのほかに受け付けるホスト名。完全一致で、大文字小文字とポートは無視する。`true` はどの名前も受け付ける。手前でホスト名を確かめている場合だけに使う |

- ほかのホスト名へのリクエストは本文なしの `400` になってアプリに届かない。最初の 1 回だけ `console.warn` に出る
- `Host` がない、複数ある、単純なホスト名とポート以外のものは `400` になる
- `X-Forwarded-For` は `trustedProxies` のときだけ読む（[クライアントの IP アドレス](#クライアントの-ip-アドレス)）。`X-Forwarded-Proto` と `X-Forwarded-Host` は使わない
- コンポーネントがリクエストボディを読まなかったとき（`413` のあとなど）は、残りを読まずに接続を閉じる
- クライアントが切断すると `ctx.request.signal` が中断され、ストリーミング中の本文も止まる
- `server.close()` は新しい接続の受け付けを止め、待機中の接続を閉じ、接続ごとに、処理中のリクエストに応答し終えたら閉じる。`timeout`（既定 10 秒。`server.close({ timeout: 30_000 })`）を過ぎたら残りを切り、その `ctx.request.signal` を中断する。`SIGTERM` を受けたときに呼べば、リクエストを落とさずに入れ替えられる

### Bun

```ts
Bun.serve({
  port: 3000,
  hostname: '127.0.0.1',
  fetch: (request, server) =>
    app.handle(request, { remoteAddress: server.requestIP(request)?.address }),
})
```

`app.handle()` で接続元のアドレスを渡し、`ctx.ip` に使う。`app.fetch` をそのまま渡してはいけない。Bun は `fetch(request, server)` と呼ぶので、Bun のサーバーが `ctx.env` に入ってしまう。`Bun.serve` はホスト名を確かめない。上のホスト名の確認は `@imatomix/mixer/node` の `serve()` のもの。

### Cloudflare Workers

```ts
type Env = { DATABASE_URL: string }

const app = new Mixer<Record<string, unknown>, Env>().mix((ctx) => ctx.env.DATABASE_URL)

export default app satisfies ExportedHandler<Env>
```

`ctx.ip` には、Cloudflare が確定させたアドレスを渡す。mixer は `CF-Connecting-IP` を自分では読まない。Cloudflare の外では誰でもこのヘッダを送れるため。

```ts
export default {
  fetch: (request, env, executionContext) =>
    app.handle(request, {
      env,
      executionContext,
      clientIp: request.headers.get('cf-connecting-ip') ?? undefined,
    }),
} satisfies ExportedHandler<Env>
```

- `ctx.env` には Worker のバインディングが入り、`ctx.waitUntil()` は Worker の `ctx.waitUntil` に渡される。mix-router を使うときは、`createRouter<State, Env>()` にもバインディングの型を渡す
- PR ごとに、workerd の互換日付 `2026-07-30`、Node 互換を切った状態（`no_nodejs_compat`、`no_nodejs_compat_v2`）で動作を確かめ、`@cloudflare/workers-types` で型も確かめている。mixer に `nodejs_compat` は要らない
- `bodyLimit` が効くのは `ctx.body()`・`ctx.text()`・`ctx.bytes()` で読んだときだけで、`ctx.request` を直接読むと効かない。`ctx.waitUntil()` に渡した処理には Workers の時間の上限がかかる

| パッケージ | Workers での扱い |
| --- | --- |
| mixer、mix-router、mix-cors、mix-csrf、mix-logger | 対応 |
| mix-session | 外部のストアを使えば対応（`MemoryStore` は 1 つの isolate の中にしかない） |
| mix-static | 非対応（ファイルシステムがない）。Workers Static Assets を使う |
| `@imatomix/mixer/node` | 使わない |

### フレームワークの中で使う

フレームワークのキャッチオールのルートに mixer を置き、そのルートのパスを `basePath` に設定して、`Request` だけを渡す。フレームワークはハンドラにほかの引数も渡すので、そのまま渡すと `ctx.env` に入ってしまう。`ctx.ip` には、SvelteKit の `getClientAddress()` のようなフレームワークのアドレスの取り方を使い、`app.handle(request, { clientIp })` で渡す。

**Next.js**（App Router）、`app/api/[[...path]]/route.ts`:

```ts
const app = new Mixer({ basePath: '/api' }).mix(/* ... */)
const handler = (request: Request) => app.fetch(request)

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE }
```

**Nuxt**（Nuxt 4、h3 v1）、`server/api/[...path].ts`（h3 v2 では `event.req` を渡す）:

```ts
const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export default defineEventHandler((event) => app.fetch(toWebRequest(event)))
```

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

## 何もしなくても安全

設定しなくても、次のようになる。

- すべての応答に `X-Content-Type-Options: nosniff` が付く
- Cookie は `HttpOnly; Secure; SameSite=Lax; Path=/`。値はエンコードされ、ヘッダを注入できる名前・パス・ドメインは拒否される
- Cookie を付けた応答は、すでに `private` か `no-store` でなければ `Cache-Control: private` になり、共有キャッシュがほかの人に渡すことがない
- `HttpError` 以外のエラーは詳細なしの `500` になる。エラーの応答はヘッダを新しく作り直し、引き継ぐのは `Access-Control-*`・`Vary`・`Set-Cookie` だけなので、通常の応答のための `Location` や `Cache-Control` がエラーに紛れ込まない
- 3 MB を超えるリクエストボディを読むと `413`、壊れた JSON は `400` になる
- `redirect()` は、ほかのオリジンを並べない限り、このサイトのパスにしか送らない
- `HEAD` の応答と `204` / `205` / `304` には本文が付かず、送らないストリームは止める
- `trustedProxies` を並べない限り `X-Forwarded-For` は無視するので、クライアントが `ctx.ip` を偽れない
- Node.js の `serve()` は `127.0.0.1` で待ち受け、ローカルのホスト名だけを受け付ける。DNS リバインディング（別のサイトのページが、自分のサーバーを指す名前を使って話しかけてくる攻撃）と、偽の `Host` ヘッダを防ぐ

mixer が代わりに決められないことが 1 つある。**メールやリダイレクトの絶対 URL を `ctx.url.host` から作らない。** `Host` ヘッダはクライアントが選ぶので、設定にあるオリジンを使う。

## 詳しい説明

### クライアントの IP アドレス

`ctx.ip` はクライアントの IP アドレス、`ctx.remoteAddress` は直接の接続元（リバースプロキシなど）の IP アドレス。どちらも正規化され（IPv6 の形の IPv4 は IPv4 になる）、何も渡されなければ `undefined`。`app.fetch` だけでは接続の情報がない。

アダプタは `app.handle(request, options)` でアドレスを渡す。それ以外は `app.fetch` と同じ。

| オプション | どこから来るか | `ctx.ip` |
| --- | --- | --- |
| `remoteAddress` | ソケット。Node.js では `serve()` が渡し、Bun では `server.requestIP(request)` | 接続元。`trustedProxies` の後ろでは `X-Forwarded-For` から求めたクライアント |
| `clientIp` | 実行環境やフレームワークが確定させたアドレス（Cloudflare の `CF-Connecting-IP`、SvelteKit の `getClientAddress()`） | そのアドレス。`X-Forwarded-For` は読まない |

リバースプロキシの後ろで動かすときは、それを `trustedProxies` に並べる。`X-Forwarded-For` を読むのは、接続元がその一覧に入るときだけ。右から見ていき、信用するプロキシを飛ばして、最初のほかのアドレスをクライアントとするので、クライアントが前に付け足した値は無視される。読む必要のある段が不正なとき、ヘッダが 8 KiB か 32 段を超えるときは、接続元に戻す。

```ts
const app = new Mixer({ trustedProxies: ['10.0.0.0/8', '::1'] })
```

IP アドレスは、プロキシの設定の誤り・NAT・VPN で正しくないことがあり、大勢で 1 つを共有することもある。ログやレート制限に使い、それだけで相手が誰かを決めない。


### Response を返す

返した `Response` は、自身のステータス・本文・ヘッダを保つ。`ctx.headers` で設定したヘッダのうち `Response` にないものは足され、`Set-Cookie` は両方残り（同じ Cookie は `Response` 側が優先）、`Vary` は両方の値を合わせる。`Response.error()` と、本文を読み終えた `Response` は `500` になる。

### フック

`ctx.onBeforeSend(fn)` は、応答を組み立てる直前に、`404` やエラーを含むすべての応答で 1 回だけ実行される。後のコンポーネントが変えた状態（セッションの Cookie など）を反映するのに使う。登録順に実行され、`ctx.status`・`ctx.headers`・Cookie を変えられる。例外を投げると応答は `500` になる。

```ts
const app = new Mixer<{ user?: string }>()

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

`ctx.onResponse(fn)` は、最終的な応答ができたあとに、スナップショット `{ status, headers }` を受け取って実行される（変えても応答には影響しない）。`app.fetch` が返る前に実行されるので、短く保ち、時間のかかる処理は `ctx.waitUntil()` に渡す。失敗はログに出るだけで、応答には影響しない。

### ctx.waitUntil()

応答を待たせずに、応答のあとで処理を実行する。動き続けるサーバー（`serve()`、`Bun.serve`）では、プロセスが動き続けるので処理は最後まで実行され、失敗はログに出る。応答のあとで止まりうる環境では、その環境の応答後の処理を登録する API を `app.fetch(request, env, { waitUntil })` のように第 3 引数で渡す。Cloudflare Workers では `export default app` がこれを代わりに行う。

### Cookie

```ts
ctx.cookies.get('theme') // 同名が複数あれば最初の値
ctx.cookies.getAll('theme')
ctx.cookies.set('theme', 'dark', { maxAge: 60 * 60 * 24 })
ctx.cookies.delete('theme') // 設定時と同じ path / domain を渡す
```

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `httpOnly` | `true` | JavaScript から読めなくする |
| `secure` | `true` | HTTPS のときだけ送る。http://localhost で開発するときは `false` に |
| `sameSite` | `'Lax'` | `'Strict'` / `'Lax'` / `'None'` |
| `path` | `'/'` | |
| `maxAge` / `expires` / `domain` / `partitioned` / `priority` | なし | |

- 1 つの応答で同じ name・path・domain を設定し直すと、前の値を置き換える
- ブラウザが拒否する組み合わせ（`Secure` なしの `SameSite=None`、`Domain` 付きの `__Host-` など）は `TypeError` を投げる
- 応答が確定したあとに Cookie を設定すると例外を投げる

### リクエストボディ

`ctx.body()` は求められたときだけボディを読み、何度呼んでも同じ結果を返す。本文は `bodyLimit`（既定 3 MB）の範囲で全部メモリに読み込むので、大きなファイルを受け取るときは上限を上げる。とても大きなファイルを流しながら保存する使い方には向かない。

| Content-Type | 結果 |
| --- | --- |
| `application/json`、`*+json` | 解析した値（不正なら `400`） |
| `application/x-www-form-urlencoded` | `{ key: value }`（同じキーは配列） |
| `multipart/form-data` | 同じ形。アップロードされたファイルは `File`（不正なら `400`） |
| `text/*` または指定なし | 文字列 |
| それ以外 | `Uint8Array` |
| 空のボディ | `undefined` |

### basePath

```ts
const app = new Mixer({ basePath: '/api' })
// GET /api/users → ctx.path === '/users'。/api の外へのリクエストは 404
```

`ctx.url` は URL 全体のまま。モジュールは `ctx.path` で照合するので、`basePath` の下でもそのまま動く。

### オプション

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `basePath` | なし | アプリを置くパス |
| `bodyLimit` | 3 MB | `ctx.body()`・`ctx.text()`・`ctx.bytes()` が読むボディの上限。超えると `413` |
| `onError` | なし | エラーの応答を組み立てる `(error, ctx) => value` |
| `trustedProxies` | なし | `ctx.ip` のために `X-Forwarded-For` を読む、リバースプロキシ（IP アドレスか CIDR の範囲） |

## モジュール

必要なものだけ入れる。どれもコンポーネントなので、自作のものに差し替えられる。

| パッケージ | 説明 |
| --- | --- |
| [@imatomix/mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router) | 型安全なルーター |
| [@imatomix/mix-cors](https://github.com/imatomix/mixer/tree/main/packages/mix-cors) | CORS |
| [@imatomix/mix-csrf](https://github.com/imatomix/mixer/tree/main/packages/mix-csrf) | CSRF 対策 |
| [@imatomix/mix-static](https://github.com/imatomix/mixer/tree/main/packages/mix-static) | 静的ファイル（Node.js と Bun） |
| [@imatomix/mix-session](https://github.com/imatomix/mixer/tree/main/packages/mix-session) | サーバサイドセッション |
| [@imatomix/mix-logger](https://github.com/imatomix/mixer/tree/main/packages/mix-logger) | アクセスログ |

## 開発

[リポジトリのルート](https://github.com/imatomix/mixer/tree/main)と [CONTRIBUTING.md](https://github.com/imatomix/mixer/blob/main/CONTRIBUTING.md) を参照。
