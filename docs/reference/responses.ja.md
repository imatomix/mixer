# 応答・エラー・Cookie

[English](responses.md) | 日本語

コンポーネントが返せる値、エラーが応答になる仕組み、Cookie の付け方。

## 返せる値

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

## リダイレクト

```ts
import { redirect } from '@imatomix/mixer'

return redirect('/login') // 302
return redirect('/orders/1', { status: 303 }) // フォームを POST した後
return redirect(ctx.url.searchParams.get('next'), { fallback: '/' }) // クライアントから受け取った値
return redirect(url, { allowedOrigins: ['https://accounts.example.com'] }) // ほかのサイト
```

`redirect()` は、うっかり利用者をほかのサイトへ送ってしまうこと（オープンリダイレクト）を防ぐ。既定では、`/` 1 つで始まるこのサイトのパスだけを受け付け、`//evil.example`、`\`、空白・制御文字、符号化された `/` や `\`、`.` と `..` の区切り、絶対 URL は `TypeError` で拒否する。クライアントから受け取った値には、代わりに使う `fallback` を渡す。ほかのサイトへは、`allowedOrigins` にオリジンを完全一致で並べたものだけ。ステータスは既定で `302`（`301`・`303`・`307`・`308` も可）で、パスに `basePath` は付け足さない。リダイレクトの前に設定した Cookie は残る。

## エラー

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

## エラーの報告

想定外のエラーは、リクエストのメソッドとパスを添えて `console.error` に出す。コンポーネントが投げたエラー（`onError` が応答に変えた場合も）、`onError` の失敗、`ctx.waitUntil()` に渡した処理の失敗、止められなかったストリームが対象。`500` 未満の `HttpError` は失敗ではなく応答の一部なので、出さない。

リクエストの ID を付けて自分のロガーに送るなど、別の場所に送るときは `ctx.onErrorReport(fn)` を登録する。リスナーが 1 つでもあれば、mixer 自身は出さない。例外を投げたリスナーはログに出るだけで、応答には影響しない。ネットワーク越しに送るなど、リスナーは Promise を返してもよい。応答はそれを待たず、`ctx.waitUntil()` に渡した処理と同じように最後まで実行される。

```ts
app.mix((ctx) => {
  ctx.onErrorReport(({ error, phase }) => {
    myLogger.error({ method: ctx.method, path: ctx.url.pathname, phase, error })
  })
})
```

`phase` は `'handling'`・`'onError'`・`'waitUntil'`・`'streamCancel'`・`'stream'`（[`sse()`](../how-to/streaming-and-background-work.ja.md#server-sent-events) の送り出す処理が投げた例外）のどれか。後ろのすべてのコンポーネントのエラーが届くよう、リスナーは最初に mix する。リクエストの処理の外で起きる Node.js のアダプター自身の失敗は、アダプターがログに出す。

## Response を返す

返した `Response` は、自身のステータス・本文・ヘッダを保つ。`ctx.headers` で設定したヘッダのうち `Response` にないものは足され、`Set-Cookie` は両方残り（同じ Cookie は `Response` 側が優先）、`Vary` は両方の値を合わせる。`Response.error()` と、本文を読み終えた `Response` は `500` になる。

## Cookie

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
