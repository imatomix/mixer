# Server-Sent Events でメッセージをリアルタイムに届ける

[English](live-messages.md) | 日本語

投稿されたメッセージを、`sse()` で、開いているブラウザすべてに届いたそばから送る。再接続したブラウザには、取りこぼしたメッセージを送る。

```ts
// examples/docs/src/live-messages.ts
import { get, post } from '@imatomix/mix-router'
import { Mixer, sse, validateInput } from '@imatomix/mixer'
import { z } from 'zod'

const NewMessage = z.strictObject({ text: z.string().min(1).max(500) })

type Message = { id: number; text: string }

export function createApp() {
  const messages: Message[] = []
  const listeners = new Set<(message: Message) => void>()

  return new Mixer().mix(
    post('/messages', async (ctx) => {
      const { text } = await validateInput(NewMessage, await ctx.json())
      const message = { id: messages.length + 1, text }
      messages.push(message)
      for (const listener of listeners) listener(message)
      ctx.status = 201
      return message
    }),

    get('/events', (ctx) =>
      sse(ctx, async (stream, signal) => {
        // 再接続したブラウザは最後に受け取った ID を送ってくる。取りこぼした分から送る
        const lastId = Number(ctx.request.headers.get('last-event-id')) || 0
        const pending = messages.filter((message) => message.id > lastId)
        let wake = () => {}
        const listener = (message: Message) => {
          pending.push(message)
          wake()
        }
        listeners.add(listener)
        signal.addEventListener('abort', () => wake())

        try {
          while (!signal.aborted) {
            const next = pending.shift()
            if (!next) {
              await new Promise<void>((resolve) => {
                wake = resolve
              })
              continue
            }
            await stream.send({
              id: String(next.id),
              event: 'message',
              data: JSON.stringify(next),
            })
          }
        } finally {
          listeners.delete(listener)
        }
      }),
    ),
  )
}
```

ブラウザでは `EventSource` がつなぎ、自分で再接続し、`Last-Event-ID` を送る。

```ts
// ブラウザで
const events = new EventSource('/events')
events.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  console.log(message.text)
})
```

- `sse()` はどの項目も安全に書き出し（メッセージの文がほかのイベントを始めることはない）、Bun やプロキシが接続を切らないよう 5 秒ごとにコメントを送り、ブラウザが去ると `signal` を中断する
- ストリームごとに `pending` の待ち行列を持ち、それを待つので、遅いブラウザがほかを止めることはない。`await stream.send()` は、そのブラウザが次を受け取れるようになると解決する
- ブラウザが去るとループが終わり、`finally` でリスナーを外すので、閉じたストリームには何も送らない。そのあとの `send` は失敗するので、`signal` を見忘れたループも終わる
- ここではメッセージをメモリに置いている。プロセスが複数あるときは、Redis の pub/sub のような共有できるものを通し、その ID を使えば、`Last-Event-ID` も働く
- Cloudflare Workers では、ブラウザが去ったことを `signal` が知らせるよう、互換日付 `2026-11-17` 以降（または `enable_request_signal`）を使う
- テストは [examples/docs/test/live-messages.test.ts](../../examples/docs/test/live-messages.test.ts)

関連: [ストリームと応答のあとの処理](../how-to/streaming-and-background-work.ja.md#server-sent-events)、[アプリをテストする](../how-to/testing.ja.md)
