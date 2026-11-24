# ストリームと応答のあとの処理

[English](streaming-and-background-work.md) | 日本語

起きたことをその場で送り、時間のかかる処理で止まらないようにし、応答のあとに処理を動かす。

## Server-Sent Events

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
- 送り出す処理が動くときには応答はもう始まっているので、そこで投げた例外はエラーの応答にできない。phase `'stream'` で[報告](../../packages/mixer/README.ja.md#エラーの報告)し、ストリームを終える。ブラウザの `EventSource` は、そのあと最後に受け取った `id` を `Last-Event-ID` に入れて再接続する
- Cloudflare Workers では、互換日付 `2026-11-17` 以降か、`enable_request_signal` フラグを使う。それより前では、クライアントが去ったことが Worker に伝わらない。送り出す処理は次の `send` で止まるが、`signal` は中断されない

## 時間のかかる処理

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
- 送るのが遅いクライアントは、アダプター（[Node.js](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md#nodejs)、[Bun](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md#bun)）か環境が扱う

## ctx.waitUntil()

応答を待たせずに、応答のあとで処理を実行する。動き続けるサーバー（`serve()`、`Bun.serve`）では、プロセスが動き続けるので処理は最後まで実行され、失敗は[報告](../../packages/mixer/README.ja.md#エラーの報告)される。応答のあとで止まりうる環境では、その環境の応答後の処理を登録する API を `app.fetch(request, env, { waitUntil })` のように第 3 引数で渡す。Cloudflare Workers では `export default app` がこれを代わりに行う。
