import { describe, expect, it } from 'vitest'
import {
  type Context,
  type ErrorReport,
  Mixer,
  type SseOptions,
  type SseStream,
  sse,
} from '../src/index.js'
import { call } from './helpers.js'

type Producer = (stream: SseStream, signal: AbortSignal) => unknown

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

function sseApp(producer: Producer, options?: SseOptions) {
  const reports: ErrorReport[] = []
  const app = new Mixer().mix(
    (ctx) => {
      ctx.onErrorReport((report) => {
        reports.push(report)
      })
    },
    (ctx) => sse(ctx, producer, options),
  )
  return { app, reports }
}

function readerOf(res: Response) {
  if (!res.body) throw new Error('The response has no body')
  return res.body.getReader()
}

async function readAll(res: Response): Promise<string> {
  return await res.text()
}

describe('sse', () => {
  it('answers with event-stream headers and no length', async () => {
    const { app } = sseApp(async (stream) => {
      await stream.send({ data: 'hi' })
    })
    const res = await call(app)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.has('content-length')).toBe(false)
    expect(res.headers.has('connection')).toBe(false)
    expect(await readAll(res)).toBe('data: hi\n\n')
  })

  it('writes every field, one data line per line of data', async () => {
    const { app } = sseApp(async (stream) => {
      await stream.send({
        id: '7',
        event: 'tick',
        retry: 1000,
        data: 'a\nb\r\nc\rd',
      })
      await stream.send({ data: '' })
    })
    expect(await readAll(await call(app))).toBe(
      'id: 7\nevent: tick\nretry: 1000\ndata: a\ndata: b\ndata: c\ndata: d\n\ndata: \n\n',
    )
  })

  it('keeps client text inside its event, so it cannot start another one', async () => {
    const { app } = sseApp(async (stream) => {
      await stream.send({ data: 'hello\n\nevent: admin\ndata: forged' })
    })
    const body = await readAll(await call(app))
    expect(body).toBe(
      'data: hello\ndata: \ndata: event: admin\ndata: data: forged\n\n',
    )
    expect(body.split('\n\n')).toHaveLength(2)
  })

  it('rejects fields that would break the format', async () => {
    const errors: unknown[] = []
    const { app } = sseApp(async (stream) => {
      const attempts = [
        { event: 'a\nb' },
        { event: 'a\rb' },
        { id: 'a\nb' },
        { id: 'a\0b' },
        { retry: -1 },
        { retry: 1.5 },
        { retry: Number.NaN },
        { data: { not: 'a string' } as never },
      ]
      for (const message of attempts) {
        await stream.send(message).catch((error: unknown) => errors.push(error))
      }
    })
    expect(await readAll(await call(app))).toBe('')
    expect(errors).toHaveLength(8)
    for (const error of errors) expect(error).toBeInstanceOf(TypeError)
  })

  it('rejects a heartbeat that is not a positive number of milliseconds', () => {
    const ctx = {} as Context
    for (const heartbeat of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sse(ctx, () => {}, { heartbeat })).toThrow(RangeError)
    }
  })

  it('does not run the producer for HEAD', async () => {
    let ran = false
    const { app } = sseApp(() => {
      ran = true
    })
    const res = await call(app, '/', { method: 'HEAD' })
    expect(res.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    )
    expect(await res.text()).toBe('')
    await wait(10)
    expect(ran).toBe(false)
  })

  it('keeps headers and cookies set on ctx before it', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.headers.set('X-Accel-Buffering', 'no')
      ctx.cookies.set('seen', '1')
      return sse(ctx, async (stream) => {
        await stream.send({ data: 'x' })
      })
    })
    const res = await call(app)
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    expect(res.headers.get('set-cookie')).toMatch(/^seen=1/)
    expect(await res.text()).toBe('data: x\n\n')
  })

  it('sends a comment when nothing was sent for the heartbeat interval', async () => {
    const { app } = sseApp(
      async (stream) => {
        await wait(75)
        await stream.send({ data: 'done' })
      },
      { heartbeat: 20 },
    )
    const body = await readAll(await call(app))
    expect(body.endsWith('data: done\n\n')).toBe(true)
    expect(body.match(/^:\n\n/gm)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('sends no heartbeat when it is turned off', async () => {
    const { app } = sseApp(
      async (stream) => {
        await wait(50)
        await stream.send({ data: 'done' })
      },
      { heartbeat: false },
    )
    expect(await readAll(await call(app))).toBe('data: done\n\n')
  })

  it('adds no heartbeat while what was sent is still unread', async () => {
    const { app } = sseApp(
      async (stream) => {
        await stream.send({ data: 'a' })
        await stream.send({ data: 'b' })
      },
      { heartbeat: 10 },
    )
    const reader = readerOf(await call(app))
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toBe('data: a\n\n')
    // 'b' waits unread; a client that stopped reading must not make the queue grow
    await wait(60)
    let rest = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      rest += decoder.decode(value)
    }
    expect(rest).toContain('data: b\n\n')
    expect(rest.match(/^:\n\n/gm)?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it('keeps at most one event waiting for a client that does not read', async () => {
    let sent = 0
    const { app } = sseApp(async (stream) => {
      for (const data of ['a', 'b', 'c', 'd']) {
        await stream.send({ data })
        sent++
      }
    })
    const reader = readerOf(await call(app))
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toBe('data: a\n\n')
    await wait(10)
    // 'b' is queued, and its send waits until the client asks for more
    expect(sent).toBe(1)
    expect(decoder.decode((await reader.read()).value)).toBe('data: b\n\n')
    expect(decoder.decode((await reader.read()).value)).toBe('data: c\n\n')
    await wait(10)
    expect(sent).toBe(3)
    await reader.cancel()
  })

  it('aborts the signal and rejects later sends when the client goes away, without reporting it', async () => {
    let signal: AbortSignal | undefined
    let laterSend: unknown
    const { app, reports } = sseApp(
      async (stream, abortSignal) => {
        signal = abortSignal
        await stream.send({ data: 'first' })
        await wait(30)
        laterSend = await stream.send({ data: 'late' }).catch((e: unknown) => e)
        throw new Error('after the client left')
      },
      { heartbeat: 10 },
    )
    const reader = readerOf(await call(app))
    await reader.read()
    await reader.cancel()
    await wait(50)
    expect(signal?.aborted).toBe(true)
    expect(laterSend).toBeInstanceOf(Error)
    expect(reports).toEqual([])
  })

  it('aborts the signal when the request is aborted', async () => {
    let signal: AbortSignal | undefined
    const { app } = sseApp(async (_stream, abortSignal) => {
      signal = abortSignal
      await new Promise((resolve) =>
        abortSignal.addEventListener('abort', resolve),
      )
    })
    const controller = new AbortController()
    const res = await call(app, '/', { signal: controller.signal })
    const reading = res.text().catch(() => '')
    await wait(10)
    controller.abort()
    await reading
    await wait(10)
    expect(signal?.aborted).toBe(true)
  })

  it('does not start for a request that was already aborted', async () => {
    let ran = false
    const { app } = sseApp(() => {
      ran = true
    })
    const res = await call(app, '/', { signal: AbortSignal.abort() })
    expect(await res.text()).toBe('')
    expect(ran).toBe(false)
  })

  it('reports an error thrown after the response started once, as phase stream, and ends the stream', async () => {
    const { app, reports } = sseApp(async (stream) => {
      await stream.send({ data: 'before' })
      throw new Error('broken producer')
    })
    expect(await readAll(await call(app))).toBe('data: before\n\n')
    await wait(10)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.phase).toBe('stream')
    expect(reports[0]?.error).toEqual(new Error('broken producer'))
  })
})
