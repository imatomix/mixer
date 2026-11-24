import {
  brotliDecompressSync,
  createGunzip,
  gunzipSync,
  gzipSync,
} from 'node:zlib'
import { type Component, sse } from '@imatomix/mixer'
import { describe, expect, it } from 'vitest'
import { type CompressOptions, compress } from '../src/index.js'
import { app, call } from './helpers.js'

const LONG_TEXT = 'mixer compresses this text. '.repeat(100)

function compressed(
  respond: Component,
  headers: Record<string, string> = { 'accept-encoding': 'gzip' },
  options?: CompressOptions,
  method = 'GET',
) {
  return call(app(compress(options), respond), '/', { method, headers })
}

async function bodyBytes(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer())
}

function varyOf(res: Response): string[] {
  return (res.headers.get('vary') ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean)
}

describe('compress', () => {
  it('gzips a text response and drops its length', async () => {
    const res = await compressed(() => LONG_TEXT)
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.has('content-length')).toBe(false)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const body = await bodyBytes(res)
    expect(body.length).toBeLessThan(LONG_TEXT.length)
    expect(gunzipSync(body).toString()).toBe(LONG_TEXT)
  })

  it('compresses a Response the app built, whose length is unknown', async () => {
    const data = { items: Array.from({ length: 200 }, (_, i) => ({ id: i })) }
    const res = await compressed(() => Response.json(data))
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(JSON.parse(gunzipSync(await bodyBytes(res)).toString())).toEqual(
      data,
    )
  })

  it('uses Brotli when it is preferred, or on a tie', async () => {
    for (const accept of ['gzip, br', 'br;q=1, gzip;q=1', 'gzip;q=0.5, br']) {
      const res = await compressed(() => LONG_TEXT, {
        'accept-encoding': accept,
      })
      expect(res.headers.get('content-encoding')).toBe('br')
      expect(brotliDecompressSync(await bodyBytes(res)).toString()).toBe(
        LONG_TEXT,
      )
    }
    const gzipFirst = await compressed(() => LONG_TEXT, {
      'accept-encoding': 'br;q=0.2, gzip;q=0.8',
    })
    expect(gzipFirst.headers.get('content-encoding')).toBe('gzip')
  })

  it('follows q=0, wildcards, and a preference for identity, and never answers 406', async () => {
    const cases: [string, string | null][] = [
      ['*', 'br'],
      ['*, br;q=0', 'gzip'],
      ['gzip;q=0, br;q=0', null],
      ['identity', null],
      ['', null],
      ['identity;q=1, gzip;q=0.5', null],
      ['identity;q=0, *;q=0', null],
      ['deflate', null],
    ]
    for (const [accept, expected] of cases) {
      const res = await compressed(() => LONG_TEXT, {
        'accept-encoding': accept,
      })
      expect(res.status, accept).toBe(200)
      expect(res.headers.get('content-encoding'), accept).toBe(expected)
      if (!expected) expect(await res.text()).toBe(LONG_TEXT)
    }
  })

  it('leaves the response alone without Accept-Encoding, but says it varies', async () => {
    const res = await compressed(() => LONG_TEXT, {})
    expect(res.headers.has('content-encoding')).toBe(false)
    expect(await res.text()).toBe(LONG_TEXT)
    expect(varyOf(res)).toEqual(['Accept-Encoding', 'Cookie', 'Authorization'])
  })

  it('skips requests with Cookie or Authorization unless allowCredentialed is set', async () => {
    for (const credential of [
      { cookie: 'sid=1' },
      { authorization: 'Bearer x' },
    ]) {
      const res = await compressed(() => LONG_TEXT, {
        'accept-encoding': 'gzip',
        ...credential,
      })
      expect(res.headers.has('content-encoding')).toBe(false)
      expect(await res.text()).toBe(LONG_TEXT)
    }
    const allowed = await compressed(
      () => LONG_TEXT,
      { 'accept-encoding': 'gzip', cookie: 'sid=1' },
      { allowCredentialed: true },
    )
    expect(allowed.headers.get('content-encoding')).toBe('gzip')
    expect(varyOf(allowed)).toEqual(['Accept-Encoding'])
  })

  it('keeps Vary fields that later components added', async () => {
    const res = await compressed((ctx) => {
      ctx.headers.set('Vary', 'Origin')
      return LONG_TEXT
    })
    expect(varyOf(res)).toEqual([
      'Origin',
      'Accept-Encoding',
      'Cookie',
      'Authorization',
    ])
  })

  it('does not compress a known length below minBytes', async () => {
    const res = await compressed(() => 'short')
    expect(res.headers.has('content-encoding')).toBe(false)
    expect(res.headers.has('vary')).toBe(false)
    const lowered = await compressed(() => 'short', undefined, { minBytes: 1 })
    expect(lowered.headers.get('content-encoding')).toBe('gzip')
  })

  it('skips responses it must not or need not compress', async () => {
    const skipped: [string, Component, string?][] = [
      ['no content', () => null],
      [
        'partial content',
        () =>
          new Response(LONG_TEXT, {
            status: 206,
            headers: {
              'content-range': 'bytes 0-10/100',
              'content-type': 'text/plain',
            },
          }),
      ],
      [
        'already encoded',
        () =>
          new Response(LONG_TEXT, {
            headers: { 'content-encoding': 'br', 'content-type': 'text/plain' },
          }),
      ],
      [
        'no-transform',
        (ctx) => {
          ctx.headers.set('Cache-Control', 'no-transform')
          return LONG_TEXT
        },
      ],
      [
        'an image',
        () =>
          new Response(LONG_TEXT, { headers: { 'content-type': 'image/png' } }),
      ],
      [
        'an ETag',
        (ctx) => {
          ctx.headers.set('ETag', '"v1"')
          return LONG_TEXT
        },
      ],
      ['a HEAD request', () => LONG_TEXT, 'HEAD'],
    ]
    for (const [label, respond, method] of skipped) {
      const res = await compressed(respond, undefined, undefined, method)
      const expected = label === 'already encoded' ? 'br' : null
      expect(res.headers.get('content-encoding'), label).toBe(expected)
    }
  })

  it('never compresses Server-Sent Events', async () => {
    const res = await compressed(
      (ctx) =>
        sse(ctx, async (stream) => {
          await stream.send({ data: LONG_TEXT })
        }),
      undefined,
      { minBytes: 0 },
    )
    expect(res.headers.has('content-encoding')).toBe(false)
    expect(await res.text()).toBe(`data: ${LONG_TEXT}\n\n`)
  })

  it('leaves out what filter rejects', async () => {
    const res = await compressed(() => LONG_TEXT, undefined, {
      filter: (ctx) => ctx.path !== '/',
    })
    expect(res.headers.has('content-encoding')).toBe(false)
    expect(await res.text()).toBe(LONG_TEXT)
  })

  it('sends each chunk of a stream as soon as it is compressed', async () => {
    let finish!: () => void
    const encoder = new TextEncoder()
    const res = await compressed(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('<p>first</p>'))
              finish = () => {
                controller.enqueue(encoder.encode('<p>second</p>'))
                controller.close()
              }
            },
          }),
          { headers: { 'content-type': 'text/html' } },
        ),
    )
    const reader = res.body?.getReader()
    if (!reader) throw new Error('no body')
    const gunzip = createGunzip()
    let text = ''
    gunzip.on('data', (chunk: Buffer) => {
      text += chunk.toString()
    })
    // The source is still open, so this only works if the first chunk was flushed
    while (!text.includes('<p>first</p>')) {
      const { value, done } = await reader.read()
      if (done) throw new Error('ended before the first chunk came out')
      gunzip.write(value)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    finish()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      gunzip.write(value)
    }
    gunzip.end()
    await new Promise((resolve) => gunzip.on('end', resolve))
    expect(text).toBe('<p>first</p><p>second</p>')
  })

  it('compresses chunks that are ready together, instead of flushing each one', async () => {
    const encoder = new TextEncoder()
    let row = 0
    const res = await compressed(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (row++ === 2000) return controller.close()
              controller.enqueue(
                encoder.encode(
                  `<tr><td>${row}</td><td>row number ${row}</td></tr>`,
                ),
              )
            },
          }),
          { headers: { 'content-type': 'text/html' } },
        ),
    )
    const body = await bodyBytes(res)
    const plain = gunzipSync(body)
    expect(plain.toString().startsWith('<tr><td>1</td>')).toBe(true)
    // Flushing every one of the 2000 chunks made it about three times the size of compressing it in one go
    expect(body.length).toBeLessThan(gzipSync(plain).length * 1.5)
  })

  it('cancels the source when the client goes away', async () => {
    let cancelled = false
    const res = await compressed(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode(LONG_TEXT))
            },
            cancel() {
              cancelled = true
            },
          }),
          { headers: { 'content-type': 'text/plain' } },
        ),
    )
    const reader = res.body?.getReader()
    if (!reader) throw new Error('no body')
    await reader.read()
    await reader.cancel()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(cancelled).toBe(true)
  })

  it('errors the response stream when the source fails', async () => {
    const res = await compressed(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(LONG_TEXT))
            },
            pull(controller) {
              controller.error(new Error('source failed'))
            },
          }),
          { headers: { 'content-type': 'text/plain' } },
        ),
    )
    await expect(res.arrayBuffer()).rejects.toThrow()
  })

  it('rejects a minBytes that is not a whole number of bytes, 0 or more', () => {
    for (const minBytes of [-1, 1.5, Number.NaN]) {
      expect(() => compress({ minBytes })).toThrow(RangeError)
    }
  })
})
