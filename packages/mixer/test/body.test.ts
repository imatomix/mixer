import { describe, expect, it } from 'vitest'
import { Mixer } from '../src/index.js'
import { call } from './helpers.js'

const echoBody = (options?: { bodyLimit?: number }) =>
  new Mixer(options).mix(async (ctx) => ({ body: await ctx.body() }))

const post = (
  body: NonNullable<RequestInit['body']>,
  headers?: Record<string, string>,
): RequestInit => ({
  method: 'POST',
  body,
  ...(headers ? { headers } : {}),
})

describe('request body', () => {
  it('parses application/json as JSON', async () => {
    const res = await call(
      echoBody(),
      '/',
      post(JSON.stringify({ name: 'ミキサー' }), {
        'content-type': 'application/json',
      }),
    )
    expect(await res.json()).toEqual({ body: { name: 'ミキサー' } })
  })

  it('parses forms and turns repeated keys into arrays', async () => {
    const res = await call(
      echoBody(),
      '/',
      post(new URLSearchParams('a=1&b=2&b=3')),
    )
    expect(await res.json()).toEqual({ body: { a: '1', b: ['2', '3'] } })
  })

  it('treats __proto__ and constructor as plain keys', async () => {
    const app = new Mixer().mix(async (ctx) => {
      const body = (await ctx.body()) as Record<string, unknown>
      return {
        keys: Object.keys(body),
        proto: Object.getPrototypeOf(body),
        body,
      }
    })
    const res = await call(
      app,
      '/',
      post(new URLSearchParams('__proto__=x&constructor=y&constructor=z')),
    )
    expect(await res.json()).toEqual({
      keys: ['__proto__', 'constructor'],
      proto: null,
      body: { ['__proto__']: 'x', constructor: ['y', 'z'] },
    })
  })

  it('treats text/* as a string', async () => {
    const res = await call(echoBody(), '/', post('plain text'))
    expect(await res.json()).toEqual({ body: 'plain text' })
  })

  it('returns bytes for other content types', async () => {
    const app = new Mixer().mix(async (ctx) => {
      const body = await ctx.body()
      return {
        isBytes: body instanceof Uint8Array,
        length: (body as Uint8Array).length,
      }
    })
    const res = await call(
      app,
      '/',
      post(new Uint8Array([1, 2, 3]), {
        'content-type': 'application/octet-stream',
      }),
    )
    expect(await res.json()).toEqual({ isBytes: true, length: 3 })
  })

  it('returns undefined for an empty body', async () => {
    const app = new Mixer().mix(async (ctx) => ({
      isUndefined: (await ctx.body()) === undefined,
    }))
    expect(await (await call(app)).json()).toEqual({ isUndefined: true })
  })

  it('returns the same content however many times body(), text(), and bytes() are called', async () => {
    const app = new Mixer().mix(async (ctx) => ({
      text: await ctx.text(),
      body: await ctx.body(),
      bytes: (await ctx.bytes()).length,
      again: await ctx.text(),
    }))
    const res = await call(
      app,
      '/',
      post('{"x":1}', { 'content-type': 'application/json' }),
    )
    expect(await res.json()).toEqual({
      text: '{"x":1}',
      body: { x: 1 },
      bytes: 7,
      again: '{"x":1}',
    })
  })

  it('restores multibyte characters split across chunks', async () => {
    const encoded = new TextEncoder().encode('あいう')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.subarray(0, 4))
        controller.enqueue(encoded.subarray(4))
        controller.close()
      },
    })
    const app = new Mixer().mix((ctx) => ctx.text())
    const res = await call(app, '/', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(await res.text()).toBe('あいう')
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await call(
      echoBody(),
      '/',
      post('{broken', { 'content-type': 'application/json' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 413 when Content-Length is over the limit', async () => {
    const res = await call(
      echoBody({ bodyLimit: 10 }),
      '/',
      post('x'.repeat(100)),
    )
    expect(res.status).toBe(413)
  })

  it('returns 413 when a streamed body without Content-Length exceeds the limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 10; i++)
          controller.enqueue(new TextEncoder().encode('xxxxx'))
        controller.close()
      },
    })
    const res = await call(echoBody({ bodyLimit: 10 }), '/', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(res.status).toBe(413)
  })

  it('returns 400 when Content-Length is not a number', async () => {
    const res = await call(
      echoBody(),
      '/',
      post('x', { 'content-length': 'abc' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('bodyLimit option', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    'rejects an invalid bodyLimit (%s), which would otherwise disable the limit',
    (bodyLimit) => {
      expect(() => new Mixer({ bodyLimit })).toThrow(RangeError)
    },
  )

  it('accepts 0, which allows no body', async () => {
    const res = await call(echoBody({ bodyLimit: 0 }), '/', {
      method: 'POST',
      body: 'x',
    })
    expect(res.status).toBe(413)
  })
})
