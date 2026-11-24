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

`app.fetch(request)` は Web 標準のただのハンドラーなので、同じアプリが Node.js と Bun では mixer のアダプターで、Cloudflare Workers では `export default app` で、ほかのフレームワークの中ではすべてを受けるルートで動く。

[Node.js](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md#nodejs)・[Bun](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md#bun)・[Cloudflare Workers](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md#cloudflare-workers)・[フレームワークの中で使う](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md#フレームワークの中で使う)は[アプリを動かす](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md)を参照。

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

`sse(ctx, async (stream, signal) => ...)` はイベントを安全に送る。定期的な送信と、クライアントが去ったときの停止を含む。[Server-Sent Events](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.ja.md#server-sent-events)を参照。

### 時間のかかる処理

mixer にはルート全体の時間の上限はない。外へ出す呼び出しそれぞれに上限を付け、処理そのものを止める。[時間のかかる処理](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.ja.md#時間のかかる処理)を参照。

### ctx.waitUntil()

応答を待たせずに、応答のあとで処理を動かす。[ctx.waitUntil()](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.ja.md#ctxwaituntil)を参照。

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

`ctx.json()`・`ctx.form()`・`ctx.text()`・`ctx.bytes()` は `bodyLimit` の範囲で本文を読み、自分の Content-Type だけを受け付ける。`validateInput()` は Zod などのスキーマで確かめる。[リクエストボディを読んで確かめる](https://github.com/imatomix/mixer/blob/main/docs/how-to/request-body.ja.md#リクエストボディ)を参照。

### ルートの前で確認する

認証ライブラリから得たサインイン中のユーザーなどを、いくつかのルートの前で 1 回確認して `ctx.state` に入れ、ルートでは小さな `requireX(ctx)` 補助関数で取り出す。[ユーザーのサインインとルートの前での確認](https://github.com/imatomix/mixer/blob/main/docs/how-to/auth-and-guards.ja.md#ルートの前で確認する)を参照。

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
