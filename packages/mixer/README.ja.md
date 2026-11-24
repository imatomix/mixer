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

リクエスト、作っている途中の応答、コンポーネントの間で渡す値、それに本文を読む・Cookie を付ける・応答のあとに処理を動かすための補助。[ctx](https://github.com/imatomix/mixer/blob/main/docs/reference/context.ja.md#ctx)を参照。

### 返せる値

文字列・オブジェクト・バイト列・ストリーム・`null`・`Response`。[返せる値](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.ja.md#返せる値)を参照。

### リダイレクト

`redirect(path)` は、ほかのオリジンを並べない限り、このサイトのパスにしか送らない。[リダイレクト](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.ja.md#リダイレクト)を参照。

### エラー

`HttpError` を投げるとそのステータスで答える。それ以外は詳細なしの `500`。[エラー](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.ja.md#エラー)を参照。

### エラーの報告

`ctx.onErrorReport()` は、応答のあとのものも含めて想定外のエラーを受け取る。[エラーの報告](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.ja.md#エラーの報告)を参照。

### 型

`new Mixer<State, Env>()` で `ctx.state` と `ctx.env` に型を付ける。[型](https://github.com/imatomix/mixer/blob/main/docs/reference/mixer.ja.md#型)を参照。

## アプリを動かす

`app.fetch(request)` は Web 標準のただのハンドラーなので、同じアプリが Node.js と Bun では mixer のアダプターで、Cloudflare Workers では `export default app` で、ほかのフレームワークの中ではすべてを受けるルートで動く。

[Node.js](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md#nodejs)・[Bun](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md#bun)・[Cloudflare Workers](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md#cloudflare-workers)・[フレームワークの中で使う](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md#フレームワークの中で使う)は[アプリを動かす](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md)を参照。

## 何もしなくても安全

設定しなくても、mixer は `nosniff` を送り、Cookie に安全な属性を付け、Cookie 付きの応答を共有キャッシュに置かせず、エラーは詳細なしで答え、リクエストボディの大きさを制限し、リダイレクトはサイトの中だけにする。`serve()` は `127.0.0.1` で待ち受け、知らないホスト名を拒否する。CSRF 対策とセキュリティヘッダーはアプリによって変わるので、mix-csrf と mix-secure-headers でそれぞれ 1 行で加える。

全体の一覧と、mixer が代わりに決められないことは[何もしなくても安全](https://github.com/imatomix/mixer/blob/main/docs/explanation/safety.ja.md)を参照。

## 詳しい説明

### クライアントの IP アドレス

`ctx.ip` はクライアントのアドレス。`X-Forwarded-For` は `trustedProxies` のときだけ使う。[クライアントの IP アドレス](https://github.com/imatomix/mixer/blob/main/docs/reference/mixer.ja.md#クライアントの-ip-アドレス)を参照。

### Response を返す

返した `Response` は、自分のステータス・本文・ヘッダーを保つ。[Response を返す](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.ja.md#response-を返す)を参照。

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

`ctx.cookies` で Cookie を読み書きする。既定で安全な属性が付く。[Cookie](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.ja.md#cookie)を参照。

### リクエストボディ

`ctx.json()`・`ctx.form()`・`ctx.text()`・`ctx.bytes()` は `bodyLimit` の範囲で本文を読み、自分の Content-Type だけを受け付ける。`validateInput()` は Zod などのスキーマで確かめる。[リクエストボディを読んで確かめる](https://github.com/imatomix/mixer/blob/main/docs/how-to/request-body.ja.md#リクエストボディ)を参照。

### ルートの前で確認する

認証ライブラリから得たサインイン中のユーザーなどを、いくつかのルートの前で 1 回確認して `ctx.state` に入れ、ルートでは小さな `requireX(ctx)` 補助関数で取り出す。[ユーザーのサインインとルートの前での確認](https://github.com/imatomix/mixer/blob/main/docs/how-to/auth-and-guards.ja.md#ルートの前で確認する)を参照。

### basePath

アプリをパスの下に載せる。`ctx.path` にはそのパスを含めない。[basePath](https://github.com/imatomix/mixer/blob/main/docs/reference/mixer.ja.md#basepath)を参照。

### オプション

`basePath`・`bodyLimit`・`trustedProxies`・`onError`。[オプション](https://github.com/imatomix/mixer/blob/main/docs/reference/mixer.ja.md#オプション)を参照。

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
