# Live messages with Server-Sent Events

English | [日本語](live-messages.ja.md)

Send each posted message to every open browser as it arrives, with `sse()`. A browser that reconnects gets the messages it missed.

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
        // A reconnecting browser sends the last ID it received; start with what it missed
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

In the browser, `EventSource` connects, reconnects by itself, and sends `Last-Event-ID`:

```ts
// In the browser
const events = new EventSource('/events')
events.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  console.log(message.text)
})
```

- `sse()` writes each field safely (the message text cannot start another event), sends a comment every 5 seconds so Bun and proxies keep the connection, and aborts `signal` when the browser goes away
- Each stream keeps its own `pending` queue and waits on it, so a slow browser does not hold up the others; `await stream.send()` resolves when that browser is ready for more
- When the browser leaves, the loop ends and `finally` removes its listener, so nothing is sent to a closed stream. A `send` after that rejects, which also ends a loop that forgot to check `signal`
- Messages live in memory here. With several processes, pass them through something they share, such as Redis pub/sub, and keep the IDs from it, so that `Last-Event-ID` still works
- On Cloudflare Workers, use compatibility date `2026-11-17` or later (or `enable_request_signal`) so that `signal` reports a browser that left
- The tests are in [examples/docs/test/live-messages.test.ts](../../examples/docs/test/live-messages.test.ts)

See also: [Streaming and background work](../how-to/streaming-and-background-work.md#server-sent-events), [Testing your app](../how-to/testing.md).
