# @imatomix/mixer

[English](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.md) | 日本語

Web 標準の `Request` / `Response` で動く、小さな Web フレームワーク。アプリを関数の並びとして書くと、mixer がその戻り値を安全な応答にする。

- **Web 標準。** `app.fetch(request)` は `Request` を受け取って `Response` を返すので、同じアプリが Node.js・Bun・Cloudflare Workers で動き、Next.js・Nuxt・SvelteKit・React Router の中でも動く
- **何もしなくても安全。** `nosniff`、Cookie の属性、Cookie を含む応答のキャッシュ、エラーの応答が、追加のコードなしで正しくなる（[後述](#何もしなくても安全)）
- **必要なものだけ選べる。** ルーティング・CORS・CSRF 対策・セキュリティヘッダー・静的ファイル・セッション・ログは[別のモジュール](#モジュール)で、どれも差し替えられる
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

http://localhost:3000 を開く。Bun では代わりに `@imatomix/mixer/bun` からインポートした `serve` を使う。ほかの動かし方は[アプリを動かす](#アプリを動かす)を参照。

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

コンポーネントは、後ろのコンポーネントを包むこともできる。`await next()` で後ろを実行し、できた応答を受け取って、ヘッダーや Cookie を足す。

```ts
app.mix(
  async (ctx, next) => {
    const started = Date.now()
    await next() // このコンポーネントより後ろをすべて実行する
    ctx.headers.set('X-Response-Time', `${Date.now() - started}ms`)
  },
  (ctx) => ({ hello: 'mixer' }),
)
```

規則は [next() で包む](#next-で包む) を参照。

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
| `await ctx.json()` / `await ctx.form()` | JSON として、またはフォームやファイルのアップロードの `FormData` として読んだリクエストボディ（[詳細](#リクエストボディ)） |
| `await ctx.text()` / `await ctx.bytes()` | 文字列またはバイト列として読んだリクエストボディ |
| `ctx.cookies` | Cookie を読み、応答に付ける（[詳細](#cookie)） |
| `ctx.error` | `await next()` のあと、後ろのコンポーネントが投げたエラー（なければ `undefined`）（[詳細](#next-で包む)） |
| `ctx.onErrorReport(fn)` | このリクエストの想定外のエラーを受け取る（[詳細](#エラーの報告)） |
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

エラーの応答に必要なヘッダは、エラー自身に持たせる。エラーの前に `ctx.headers` と `ctx.cookies` で設定したものは引き継がれない。通常の応答のためのものがエラーに紛れ込まないようにするため。セキュリティヘッダーやセッションの Cookie のように、エラーの応答にも届ける必要があるコンポーネントは、`await next()` のあとで付ける。

```ts
throw new HttpError(429, 'Too Many Requests', { headers: { 'Retry-After': '60' } })
```

エラーの応答を自分で組み立てるときは `onError` を渡す。`ctx.status` にエラーのステータスが入った状態で呼ばれ、戻り値が応答になる。`undefined` を返すか例外を投げると、既定の応答になる。ここでは `ctx.state` がそろっていないことがある。状態を入れるコンポーネントより前にエラーが起きたり、どのコンポーネントも見ていない `basePath` の外へのリクエストだったりするため。そこで `onError` の中では `ctx.state` のプロパティは省略可能な型になる（`ctx.state.log?.requestId` のように書く）。

```ts
const app = new Mixer({
  onError: (error, ctx) => ({ message: 'Sorry', status: ctx.status }),
})
```

### エラーの報告

想定外のエラーは、リクエストのメソッドとパスを添えて `console.error` に出す。コンポーネントが投げたエラー（`onError` が応答に変えた場合も）、`onError` の失敗、`ctx.waitUntil()` に渡した処理の失敗、止められなかったストリームが対象。`500` 未満の `HttpError` は失敗ではなく応答の一部なので、出さない。

リクエストの ID を付けて自分のロガーに送るなど、別の場所に送るときは `ctx.onErrorReport(fn)` を登録する。リスナーが 1 つでもあれば、mixer 自身は出さない。例外を投げたリスナーはログに出るだけで、応答には影響しない。ネットワーク越しに送るなど、リスナーは Promise を返してもよい。応答はそれを待たず、`ctx.waitUntil()` に渡した処理と同じように最後まで実行される。

```ts
app.mix((ctx) => {
  ctx.onErrorReport(({ error, phase }) => {
    myLogger.error({ method: ctx.method, path: ctx.url.pathname, phase, error })
  })
})
```

`phase` は `'handling'`・`'onError'`・`'waitUntil'`・`'streamCancel'`・`'stream'`（[`sse()`](#server-sent-events) の送り出す処理が投げた例外）のどれか。後ろのすべてのコンポーネントのエラーが届くよう、リスナーは最初に mix する。リクエストの処理の外で起きる Node.js のアダプター自身の失敗は、アダプターがログに出す。

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
- 送るのが遅いクライアントは、Node 自身の上限で切られる。ヘッダーは 60 秒、リクエスト全体は 300 秒。効くのは受信の間だけで、遅いハンドラーやストリームで返す応答には効かない（[時間のかかる処理](#時間のかかる処理)）
- `server.close()` は新しい接続の受け付けを止め、待機中の接続を閉じ、接続ごとに、処理中のリクエストに応答し終えたら閉じる。`timeout`（既定 10 秒。`server.close({ timeout: 30_000 })`）を過ぎたら残りを切り、その `ctx.request.signal` を中断する。`SIGTERM` を受けたときに呼べば、リクエストを落とさずに入れ替えられる

### Bun

```ts
import { serve } from '@imatomix/mixer/bun'

const server = await serve(app, { port: 3000 })
// 終了するとき:
await server.close()
```

Node.js アダプタと同様、既定では `127.0.0.1` で待ち受け、知らない Host 名は 400 で拒否する。オプションは `hostname`・`port`（既定は `0`、空いているポート）・`allowedHosts` のみで、意味は上と同じ。`server.requestIP(request)` を `app.handle()` に渡して `ctx.ip` に使い、Bun のサーバーを `ctx.env` に入れない。`server.close()` は処理中のリクエストが終わるまで待つ。終了のタイムアウト指定はない。ハンドラーが例外を投げたり Promise が失敗したりした場合は、開発モードでもサーバー側にエラーを記録し、本文のない 500 応答を返す。Bun は、何も送らない時間が 10 秒続いた接続を閉じる（既定の `idleTimeout`）。応答するまでにそれより長くかかるハンドラーや、それだけ止まるストリームは切られる。

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
- クライアントが切断したときに `ctx.request.signal` が中断されるのは、互換日付 `2026-11-17` 以降か、それより前で `enable_request_signal` フラグを付けたときだけ
- `bodyLimit` が効くのは `ctx.json()`・`ctx.form()`・`ctx.text()`・`ctx.bytes()` で読んだときだけで、`ctx.request` を直接読むと効かない。`ctx.waitUntil()` に渡した処理には Workers の時間の上限がかかる

| パッケージ | Workers での扱い |
| --- | --- |
| mixer、mix-router、mix-cors、mix-csrf、mix-secure-headers、mix-logger | 対応 |
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

設定しなくても、mixer は `nosniff` を送り、Cookie に安全な属性を付け、Cookie 付きの応答を共有キャッシュに置かせず、エラーは詳細なしで答え、リクエストボディの大きさを制限し、リダイレクトはサイトの中だけにする。`serve()` は `127.0.0.1` で待ち受け、知らないホスト名を拒否する。CSRF 対策とセキュリティヘッダーはアプリによって変わるので、mix-csrf と mix-secure-headers でそれぞれ 1 行で加える。

全体の一覧と、mixer が代わりに決められないことは[何もしなくても安全](https://github.com/imatomix/mixer/blob/main/docs/explanation/safety.ja.md)を参照。

## 詳しい説明

### クライアントの IP アドレス

`ctx.ip` はクライアントの IP アドレス、`ctx.remoteAddress` は直接の接続元（リバースプロキシなど）の IP アドレス。どちらも正規化され（IPv6 の形の IPv4 は IPv4 になる）、何も渡されなければ `undefined`。`app.fetch` だけでは接続の情報がない。

アダプタは `app.handle(request, options)` でアドレスを渡す。それ以外は `app.fetch` と同じ。

| オプション | どこから来るか | `ctx.ip` |
| --- | --- | --- |
| `remoteAddress` | ソケット。Node.js と Bun のアダプタが `app.handle()` に渡す | 接続元。`trustedProxies` の後ろでは `X-Forwarded-For` から求めたクライアント |
| `clientIp` | 実行環境やフレームワークが確定させたアドレス（Cloudflare の `CF-Connecting-IP`、SvelteKit の `getClientAddress()`） | そのアドレス。`X-Forwarded-For` は読まない |

リバースプロキシの後ろで動かすときは、それを `trustedProxies` に並べる。`X-Forwarded-For` を読むのは、接続元がその一覧に入るときだけ。右から見ていき、信用するプロキシを飛ばして、最初のほかのアドレスをクライアントとするので、クライアントが前に付け足した値は無視される。読む必要のある段が不正なとき、ヘッダが 8 KiB か 32 段を超えるときは、接続元に戻す。

```ts
const app = new Mixer({ trustedProxies: ['10.0.0.0/8', '::1'] })
```

IP アドレスは、プロキシの設定の誤り・NAT・VPN で正しくないことがあり、大勢で 1 つを共有することもある。ログやレート制限に使い、それだけで相手が誰かを決めない。


### Response を返す

返した `Response` は、自身のステータス・本文・ヘッダを保つ。`ctx.headers` で設定したヘッダのうち `Response` にないものは足され、`Set-Cookie` は両方残り（同じ Cookie は `Response` 側が優先）、`Vary` は両方の値を合わせる。`Response.error()` と、本文を読み終えた `Response` は `500` になる。

### next() で包む

コンポーネントは 2 つ目の引数に `next` を受け取る。`await next()` は後ろのコンポーネントを実行して、その `Response` を返す。例外は投げず、後ろで起きたエラーは `ctx.error` に残る。そのあとは `ctx.headers`・`ctx.cookies`・`ctx.status` を変えるか、新しい `Response` を丸ごと返す。

例と規則は[next() によるコンポーネントの組み立て](https://github.com/imatomix/mixer/blob/main/docs/explanation/composition.ja.md)を参照。

### Server-Sent Events

`sse()` はイベントのストリームで応答する。どの項目も安全に書き出す。`data` の各行はそれぞれ `data:` の行になるので、クライアントの文字列がイベントを終わらせて偽のイベントを始めることはない。改行を含む `event` や `id` は例外になる。

```ts
import { sse } from '@imatomix/mixer'

get('/events', (ctx) =>
  sse(ctx, async (stream, signal) => {
    while (!signal.aborted) {
      const update = await nextUpdate(signal)
      await stream.send({ event: 'update', id: update.id, data: JSON.stringify(update) })
    }
  }),
)
```

- `data` は文字列。ほかの値は `JSON.stringify` を使う。`retry` はクライアントが再接続するまでの待ち時間（ミリ秒）
- クライアントが去ると `signal` が中断される。そのあとの `send` は失敗するので、`signal` を見ないループも終わる
- `send` はクライアントが次を受け取れるようになったときに解決する。`send` を 1 つずつ await すれば、メモリで待つイベントは最大 1 件
- 5 秒間何も送らなかったときはコメント行を送る。そのため、何も送らない接続を 10 秒で閉じる Bun やプロキシでも、接続が保たれる。`sse(ctx, producer, { heartbeat: 15_000 })` で間隔を変え、`heartbeat: false` で止める
- 応答は `text/event-stream; charset=utf-8` で、`Cache-Control: no-store` を付ける。それより前に `ctx` に付けたヘッダーと Cookie は残る。nginx の後ろでは、ストリームをためこまないよう `X-Accel-Buffering: no` を付ける
- 送り出す処理は、クライアントが本文を読み始めたときに始まる。そのため `HEAD` のリクエストでは動かない
- 送り出す処理が動くときには応答はもう始まっているので、そこで投げた例外はエラーの応答にできない。phase `'stream'` で[報告](#エラーの報告)し、ストリームを終える。ブラウザの `EventSource` は、そのあと最後に受け取った `id` を `Last-Event-ID` に入れて再接続する
- Cloudflare Workers では、互換日付 `2026-11-17` 以降か、`enable_request_signal` フラグを使う。それより前では、クライアントが去ったことが Worker に伝わらない。送り出す処理は次の `send` で止まるが、`signal` は中断されない

### 時間のかかる処理

mixer には、ルート全体の時間の上限はない。JavaScript は実行中の処理を止められないので、先に応答しても処理は続き、クライアントに失敗と伝えたあとで書き込みが保存されることがある。代わりに外へ出す呼び出しそれぞれに上限を付け、処理そのものを止める。

```ts
get('/weather', async (ctx) => {
  const res = await fetch(WEATHER_API, {
    // クライアントが去るか 5 秒経つと止まる
    signal: AbortSignal.any([ctx.request.signal, AbortSignal.timeout(5_000)]),
  })
  return Response.json(await res.json())
})
```

- 止まった呼び出しは例外を投げ、ルートで捕まえなければ `500` になる
- signal を受け取るほかのクライアント（データベースのドライバーなど）にも同じ signal を渡す
- 止めても、すでに済んだ書き込みは取り消されない。必ず終わらせたい処理はルートの中で await し、`ctx.waitUntil()` に任せない。その処理が成功したかはクライアントに伝わらず、環境によっては途中で切られる
- 送るのが遅いクライアントは、アダプター（[Node.js](#nodejs)、[Bun](#bun)）か環境が扱う

### ctx.waitUntil()

応答を待たせずに、応答のあとで処理を実行する。動き続けるサーバー（`serve()`、`Bun.serve`）では、プロセスが動き続けるので処理は最後まで実行され、失敗は[報告](#エラーの報告)される。応答のあとで止まりうる環境では、その環境の応答後の処理を登録する API を `app.fetch(request, env, { waitUntil })` のように第 3 引数で渡す。Cloudflare Workers では `export default app` がこれを代わりに行う。

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

ルートが受け取るボディの種類を明示する。それぞれの読み方は自分の Content-Type だけを受け付け、それ以外は何も読まずに `415` を返す。

| メソッド | 受け付けるもの | 結果 |
| --- | --- | --- |
| `ctx.json()` | `application/json`、`application/*+json` | 解析した値。型は `unknown`（不正か空なら `400`） |
| `ctx.form()` | `application/x-www-form-urlencoded`、`multipart/form-data` | `FormData`。`get(name)`・`getAll(name)` で文字列、アップロードは `File` が得られる（不正なら `400`） |
| `ctx.text()` / `ctx.bytes()` | 何でも | 文字列 / `Uint8Array` |

そのため JSON のルートが、ブラウザが別のサイトから事前の確認なしに送れるフォームや `text/plain` を解析することはない。ただの別サイトのフォームから JSON のルートに届かなくなるが、Cookie に頼るルートの CSRF 対策の代わりにはならない。そうしたルートには mix-csrf を使う。

値はクライアントから来るので、使う前に確かめる。`ctx.json()` が `unknown` を返すのはそのため。

```ts
post('/todos', async (ctx) => {
  const form = await ctx.form()
  const title = form.get('title')
  if (typeof title !== 'string' || title.length === 0 || title.length > 200) {
    throw new HttpError(422, 'A title is between 1 and 200 characters')
  }
  // ...
})
```

スキーマのライブラリを使うときは、`validateInput()` で確かめる。[Standard Schema](https://standardschema.dev) に対応したスキーマ（Zod 3.24 以降、Valibot、ArkType など）を受け取り、スキーマの出力を型付きで返す。

```ts
import { validateInput } from '@imatomix/mixer'
import { z } from 'zod'

const NewItem = z.strictObject({ title: z.string().min(1).max(200), count: z.number().int() })

post('/api/items', async (ctx) => {
  const item = await validateInput(NewItem, await ctx.json()) // { title: string; count: number }
  // ...
})
```

- 合わないデータには `422` と `{ "error": "Invalid request data" }` を返し、障害としては報告しない。JSON の書き方が壊れていれば今までどおり `400`、Content-Type が違えば `415`、上限を超えれば `413`
- 何が違ったか（issues）は応答に載せない。そのメッセージにクライアントの値が入ることがあるため。見せたいときは `onError` で `error.issues` を読む：`if (error instanceof ValidationError) return Response.json({ issues: error.issues }, { status: 422 })`
- issues を返す代わりに例外を投げるスキーマは不具合なので、`500` になり報告される
- クライアントから来た値にだけ使う。設定や保存済みのデータが確認に通らないのはサーバー側の問題で、`422` ではない
- 知らないキーはスキーマで拒むか取り除く（上の `z.strictObject`）。`__proto__` のようなキーがアプリの奥まで届かないようにするため
- ほかの入力にも使える。フォームは `Object.fromEntries(await ctx.form())`（名前ごとに値は 1 つ。繰り返す項目は `getAll` を使う）、クエリは `Object.fromEntries(ctx.url.searchParams)`、ルートのパラメータはそのまま渡す

ボディは求められたときだけ読み、どの読み方も何度呼んでも同じ内容を返す。本文は `bodyLimit`（既定 3 MB）の範囲で全部メモリに読み込む。とても大きなファイルを流しながら保存する使い方には向かない。

あるルートだけ上限を変えるには、そのルートが本文を読むところで `bodyLimit` を渡す。ほかのルートにはアプリの上限が効いたままなので、アップロードのルートのために他のルートまで大きな本文を受け付けることはない。

```ts
post('/photos', async (ctx) => {
  const form = await ctx.form({ bodyLimit: 50 * 1024 * 1024 }) // このルートだけ
  // ...
})
post('/api/items', async (ctx) => {
  const item = await ctx.json({ bodyLimit: 64 * 1024 }) // 小さくしてもよい
  // ...
})
```

4 つの読み方すべてが受け取る。本文は 1 回しか読まないので、あとから小さい `bodyLimit` で読むと読んだ本文をそれで確かめ直し、ある読み方で断られた本文を、あとから大きい上限で読み直すことはできない。前段のプロキシ・CDN・WAF でもリクエストの大きさを制限できるが、アプリの上限は前段の有無に関係なく効く。

### ルートの前で確認する

いくつかのルートが先に確認を必要とするとき（サインインしたユーザー、そのユーザーが属する組織など）は、ガードで 1 回確認し、結果を `ctx.state` に入れる。ガードは [namespace](https://github.com/imatomix/mixer/blob/main/packages/mix-router/README.ja.md#namespace-の中のコンポーネント) の最初に書く。そうすると、どのルートにも合わないパスを含め、そのプレフィックスの下のすべてのリクエストで動く。ルートでは、値がなければ例外を投げる小さな `requireX(ctx)` 補助関数で取り出す。ガードを置き忘れたりルートより後ろに置いたりしても、`undefined` のまま進まずに大きく失敗する。

誰がリクエストしたかで中身が変わる応答は、共有キャッシュに置かせてはいけない。ガードで `await next()` のあとに `Cache-Control` を付けると、エラーも含めてガードの下のすべての応答に届く。`private` は共有キャッシュに保存させず、`no-store` はどのキャッシュにも保存させない。mixer が自分で応答を private にするのは Cookie を付けるときだけで、mix-session はセッションのある応答に付ける。値を読むだけのガードでは、どちらも起きない。ガードが `next()` の前に返す応答（リダイレクトなど）がリクエストによって変わるなら、それにも別に付ける。

例として、ユーザーのサインイン。mixer はパスワードの確認や ID プロバイダーとのやり取りをしない。それには認証ライブラリを使う。mixer は、そのまわりの部品（セッション、CSRF 対策、安全な Cookie、上のキャッシュの扱い）とガードを用意する。

```ts
import { HttpError, redirect } from '@imatomix/mixer'
import { all, createRouter } from '@imatomix/mix-router'

type User = { id: string; name: string }
type State = { user?: User }
const { get, namespace } = createRouter<State>()

function requireUser(ctx: { state: State }): User {
  if (!ctx.state.user) throw new HttpError(401)
  return ctx.state.user
}

app.mix(
  // Web の Request を受けて Response を返すライブラリは、ルートとしてつなげる（ここでは Better Auth）
  all('/api/auth/*', (ctx) => auth.handler(ctx.request)),
  namespace('/app')(
    async (ctx, next) => {
      const result = await auth.api.getSession({ headers: ctx.request.headers })
      if (!result) return redirect('/login', { status: 303 })
      ctx.state.user = result.user
      await next()
      // 1 人のユーザー向けのページを共有キャッシュに置かせない
      ctx.headers.set('Cache-Control', 'private, no-store')
    },
    get('/', (ctx) => `hello ${requireUser(ctx).name}`),
  ),
)
```

- `ctx.request` をライブラリに渡すルートより前で、リクエストの本文を読まない。本文は 1 回しか読めない
- 自分のセッションの Cookie を持つライブラリなら、サインインのために mix-session はいらない。代わりに mix-session を使うなら、サインインしたときに `ctx.state.session.regenerate()` を呼ぶ
- Node.js の `req`/`res` を前提に作られたライブラリ（Passport など）は、Web の `Request`/`Response` では動かない

ほかの値も同じ形で扱える。このガードの後ろに 2 つ目のガードを置いて、サインインしたユーザーが属する組織を調べて `ctx.state.org` に入れ、ルートでは `requireOrg(ctx)` を呼ぶ。

ルートがこの形で値を受け取る理由は [ADR 0002](https://github.com/imatomix/mixer/blob/main/docs/adr/0002-signed-in-user-in-routes.md) を参照。

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
| `bodyLimit` | 3 MB | `ctx.json()`・`ctx.form()`・`ctx.text()`・`ctx.bytes()` が読むボディの上限。超えると `413`。読むときに `bodyLimit` を渡せば、そのルートだけ変えられる（[詳細](#リクエストボディ)） |
| `onError` | なし | エラーの応答を組み立てる `(error, ctx) => value` |
| `trustedProxies` | なし | `ctx.ip` のために `X-Forwarded-For` を読む、リバースプロキシ（IP アドレスか CIDR の範囲） |

## モジュール

必要なものだけ入れる。どれもコンポーネントなので、自作のものに差し替えられる。

| パッケージ | 説明 |
| --- | --- |
| [@imatomix/mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router) | 型安全なルーター |
| [@imatomix/mix-cors](https://github.com/imatomix/mixer/tree/main/packages/mix-cors) | CORS |
| [@imatomix/mix-csrf](https://github.com/imatomix/mixer/tree/main/packages/mix-csrf) | CSRF 対策 |
| [@imatomix/mix-secure-headers](https://github.com/imatomix/mixer/tree/main/packages/mix-secure-headers) | セキュリティヘッダー |
| [@imatomix/mix-static](https://github.com/imatomix/mixer/tree/main/packages/mix-static) | 静的ファイル（Node.js と Bun） |
| [@imatomix/mix-session](https://github.com/imatomix/mixer/tree/main/packages/mix-session) | サーバサイドセッション |
| [@imatomix/mix-logger](https://github.com/imatomix/mixer/tree/main/packages/mix-logger) | リクエスト単位のログ |

## 開発

[リポジトリのルート](https://github.com/imatomix/mixer/tree/main)と [CONTRIBUTING.md](https://github.com/imatomix/mixer/blob/main/CONTRIBUTING.md) を参照。
