import { describe, expect, it } from 'vitest'
import { createApp } from '../src/live-messages.ts'

function setup() {
  const app = createApp()
  const send = (path: string, init?: RequestInit) =>
    app.fetch(new Request(`http://localhost${path}`, init))
  const postMessage = (text: string) =>
    send('/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  /** Opens the event stream and reads it one event at a time */
  async function listen(lastEventId?: string) {
    const res = await send('/events', {
      headers: lastEventId ? { 'last-event-id': lastEventId } : {},
    })
    const reader = res.body?.getReader()
    if (!reader) throw new Error('no body')
    const decoder = new TextDecoder()
    let buffer = ''
    return {
      res,
      async next(): Promise<string> {
        while (!buffer.includes('\n\n')) {
          const { value, done } = await reader.read()
          if (done) throw new Error('the stream ended')
          buffer += decoder.decode(value)
        }
        const end = buffer.indexOf('\n\n')
        const event = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        return event
      },
      close: () => reader.cancel(),
    }
  }
  return { postMessage, listen }
}

describe('the live messages example', () => {
  it('sends a posted message to every open stream', async () => {
    const { postMessage, listen } = setup()
    const alice = await listen()
    const bob = await listen()
    expect(alice.res.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    )

    const posted = await postMessage('hello')
    expect(posted.status).toBe(201)

    const event = 'id: 1\nevent: message\ndata: {"id":1,"text":"hello"}'
    expect(await alice.next()).toBe(event)
    expect(await bob.next()).toBe(event)
    await alice.close()
    await bob.close()
  })

  it('sends what a reconnecting browser missed, from its Last-Event-ID', async () => {
    const { postMessage, listen } = setup()
    await postMessage('first')
    await postMessage('second')
    const back = await listen('1')
    expect(await back.next()).toBe(
      'id: 2\nevent: message\ndata: {"id":2,"text":"second"}',
    )
    await back.close()
  })

  it('keeps working for others after one browser leaves', async () => {
    const { postMessage, listen } = setup()
    const leaving = await listen()
    const staying = await listen()
    await leaving.close()
    expect((await postMessage('still here')).status).toBe(201)
    expect(await staying.next()).toContain('"text":"still here"')
    await staying.close()
  })

  it('answers 422 for a message that is empty or too long', async () => {
    const { postMessage } = setup()
    expect((await postMessage('')).status).toBe(422)
    expect((await postMessage('x'.repeat(501))).status).toBe(422)
  })
})
