import { describe, expect, it, vi } from 'vitest'
import { type Context, Mixer } from '../src/index.js'
import { call } from './helpers.js'

const echoJson = (options?: { bodyLimit?: number }) =>
  new Mixer(options).mix(async (ctx) => ({ json: await ctx.json() }))

const echoForm = (options?: { bodyLimit?: number }) =>
  new Mixer(options).mix(async (ctx) => {
    const form = await ctx.form()
    const fields: Record<string, string[]> = Object.create(null)
    for (const key of new Set(form.keys())) {
      fields[key] = form
        .getAll(key)
        .map((value) =>
          typeof value === 'string' ? value : `file:${value.name}`,
        )
    }
    return fields
  })

const post = (
  body: NonNullable<RequestInit['body']>,
  headers?: Record<string, string>,
): RequestInit => ({
  method: 'POST',
  body,
  ...(headers ? { headers } : {}),
})

describe('ctx.json()', () => {
  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON',
    'application/problem+json',
  ])('parses %s', async (type) => {
    const res = await call(
      echoJson(),
      '/',
      post(JSON.stringify({ name: 'ミキサー' }), { 'content-type': type }),
    )
    expect(await res.json()).toEqual({ json: { name: 'ミキサー' } })
  })

  it.each([
    ['a form', 'application/x-www-form-urlencoded', 'a=1'],
    ['multipart', 'multipart/form-data; boundary=x', '--x--\r\n'],
    [
      'text/plain, which browsers send cross-site without a preflight',
      'text/plain',
      '{"a":1}',
    ],
  ])(
    'answers 415 for %s, so a JSON route cannot be reached by a cross-site form',
    async (_label, type, body) => {
      const res = await call(
        echoJson(),
        '/',
        post(body, { 'content-type': type }),
      )
      expect(res.status).toBe(415)
    },
  )

  it('answers 415 without a Content-Type', async () => {
    const res = await call(echoJson(), '/', {
      method: 'POST',
      body: new Uint8Array([123, 125]),
    })
    expect(res.status).toBe(415)
  })

  it('checks the type before reading, so an oversized body of the wrong type is 415', async () => {
    const res = await call(
      echoJson({ bodyLimit: 1 }),
      '/',
      post('x'.repeat(100), { 'content-type': 'text/plain' }),
    )
    expect(res.status).toBe(415)
  })

  it.each([
    ['invalid JSON', '{broken'],
    ['an empty body', ''],
  ])('answers 400 for %s', async (_label, body) => {
    const res = await call(
      echoJson(),
      '/',
      post(body, { 'content-type': 'application/json' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('ctx.form()', () => {
  it('reads a urlencoded form, keeping repeated keys', async () => {
    const res = await call(
      echoForm(),
      '/',
      post(new URLSearchParams('a=1&b=2&b=3')),
    )
    expect(await res.json()).toEqual({ a: ['1'], b: ['2', '3'] })
  })

  it('treats __proto__ and constructor as plain field names', async () => {
    const res = await call(
      echoForm(),
      '/',
      post(new URLSearchParams('__proto__=x&constructor=y')),
    )
    expect(await res.json()).toEqual({
      ['__proto__']: ['x'],
      constructor: ['y'],
    })
  })

  it('reads multipart fields and files', async () => {
    const form = new FormData()
    form.append('title', 'ミキサー')
    form.append(
      'file',
      new File(['hello'], 'hello.txt', { type: 'text/plain' }),
    )
    const app = new Mixer().mix(async (ctx) => {
      const body = await ctx.form()
      const file = body.get('file')
      return {
        title: body.get('title'),
        file:
          file instanceof File
            ? [file.name, file.type, await file.text()]
            : null,
      }
    })
    const res = await call(app, '/', { method: 'POST', body: form })
    expect(await res.json()).toEqual({
      title: 'ミキサー',
      file: ['hello.txt', 'text/plain', 'hello'],
    })
  })

  it.each([
    ['JSON', 'application/json', '{"a":1}'],
    ['text', 'text/plain', 'a=1'],
  ])('answers 415 for %s', async (_label, type, body) => {
    const res = await call(
      echoForm(),
      '/',
      post(body, { 'content-type': type }),
    )
    expect(res.status).toBe(415)
  })

  it.each([
    [
      'a malformed multipart body',
      'multipart/form-data; boundary=x',
      'not multipart',
    ],
    ['a missing boundary', 'multipart/form-data', '--x\r\n'],
  ])('answers 400 for %s', async (_label, type, body) => {
    const res = await call(
      echoForm(),
      '/',
      post(body, { 'content-type': type }),
    )
    expect(res.status).toBe(400)
  })

  it('applies bodyLimit to uploads', async () => {
    const form = new FormData()
    form.append('file', new File(['x'.repeat(100)], 'big.txt'))
    const res = await call(echoForm({ bodyLimit: 10 }), '/', {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(413)
  })
})

describe('reading the body', () => {
  it('returns the same content however many times json(), text(), and bytes() are called', async () => {
    const app = new Mixer().mix(async (ctx) => ({
      text: await ctx.text(),
      json: await ctx.json(),
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
      json: { x: 1 },
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

  it('returns 413 when Content-Length is over the limit', async () => {
    const app = new Mixer({ bodyLimit: 10 }).mix((ctx) => ctx.text())
    const res = await call(app, '/', post('x'.repeat(100)))
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
    const app = new Mixer({ bodyLimit: 10 }).mix((ctx) => ctx.text())
    const res = await call(app, '/', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(res.status).toBe(413)
  })

  it('returns 400 when Content-Length is not a number', async () => {
    const app = new Mixer().mix((ctx) => ctx.text())
    const res = await call(app, '/', post('x', { 'content-length': 'abc' }))
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
    const app = new Mixer({ bodyLimit: 0 }).mix((ctx) => ctx.text())
    const res = await call(app, '/', { method: 'POST', body: 'x' })
    expect(res.status).toBe(413)
  })
})

describe('bodyLimit for one read', () => {
  const big = 'x'.repeat(100)

  it.each([
    ['bytes', (ctx: Context) => ctx.bytes({ bodyLimit: 1000 })],
    ['text', (ctx: Context) => ctx.text({ bodyLimit: 1000 })],
    [
      'json',
      (ctx: Context) => ctx.json({ bodyLimit: 1000 }),
      'application/json',
      JSON.stringify(big),
    ],
    [
      'form',
      (ctx: Context) => ctx.form({ bodyLimit: 1000 }),
      'application/x-www-form-urlencoded',
      `a=${big}`,
    ],
  ])(
    'raises the limit for %s on one route only',
    async (_label, read, type = 'text/plain', body = big) => {
      const app = new Mixer({ bodyLimit: 10 }).mix(async (ctx) => {
        if (ctx.path === '/upload') {
          await read(ctx)
          return 'read'
        }
        return ctx.text()
      })
      const init = post(body, { 'content-type': type })
      expect((await call(app, '/upload', init)).status).toBe(200)
      expect(
        (await call(app, '/other', post(body, { 'content-type': type })))
          .status,
      ).toBe(413)
    },
  )

  it('lowers the limit for one read', async () => {
    const app = new Mixer().mix((ctx) => ctx.json({ bodyLimit: 8 }))
    const res = await call(
      app,
      '/',
      post(JSON.stringify(big), { 'content-type': 'application/json' }),
    )
    expect(res.status).toBe(413)
  })

  it('checks the body already read against a smaller limit given later', async () => {
    const app = new Mixer().mix(async (ctx) => {
      await ctx.text({ bodyLimit: 1000 })
      return ctx.bytes({ bodyLimit: 8 })
    })
    expect((await call(app, '/', post(big))).status).toBe(413)
  })

  it('does not let a later, larger limit read a body that was already refused', async () => {
    const app = new Mixer().mix(async (ctx) => {
      await ctx.text({ bodyLimit: 8 }).catch(() => undefined)
      return ctx.text({ bodyLimit: 1000 })
    })
    expect((await call(app, '/', post(big))).status).toBe(413)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'answers 500 for an invalid bodyLimit (%s)',
    async (bodyLimit) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const app = new Mixer().mix((ctx) => ctx.text({ bodyLimit }))
      expect((await call(app, '/', post('x'))).status).toBe(500)
    },
  )
})
