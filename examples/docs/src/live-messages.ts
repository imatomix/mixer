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
