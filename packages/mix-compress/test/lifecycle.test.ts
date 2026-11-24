import type { Gzip } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

const compressors: Gzip[] = []

vi.mock('node:zlib', async (importOriginal) => {
  const zlib = await importOriginal<typeof import('node:zlib')>()
  return {
    ...zlib,
    createGzip: (...args: Parameters<typeof zlib.createGzip>) => {
      const compressor = zlib.createGzip(...args)
      compressors.push(compressor)
      return compressor
    },
  }
})

const { compress } = await import('../src/index.js')
const { app, call } = await import('./helpers.js')

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const encoder = new TextEncoder()

afterEach(() => {
  compressors.length = 0
  vi.restoreAllMocks()
})

function streamed(source: ReadableStream<Uint8Array>) {
  return call(
    app(
      compress(),
      () => new Response(source, { headers: { 'content-type': 'text/html' } }),
    ),
    '/',
    { headers: { 'accept-encoding': 'gzip' } },
  )
}

describe('compress lifecycle', () => {
  it('stops without finishing the compressor when the client cancels during a pending read', async () => {
    let sourceCancelled = false
    const res = await streamed(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('<p>first</p>'))
        },
        cancel() {
          sourceCancelled = true
        },
      }),
    )
    const reader = res.body?.getReader()
    if (!reader) throw new Error('no body')
    await reader.read()
    // This read waits on the source, which has nothing more yet
    const pending = reader.read()
    await wait(10)
    await reader.cancel()
    await pending
    await wait(10)
    expect(sourceCancelled).toBe(true)
    expect(compressors).toHaveLength(1)
    // Ending a destroyed compressor never emits 'end', so a pull that tried would wait forever
    expect(compressors[0]?.writableEnded).toBe(false)
  })

  it('clears the timer of every race the source won', async () => {
    const created = new Set<unknown>()
    const fired = new Set<unknown>()
    const cleared = new Set<unknown>()
    const realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      const handle: unknown = realSetTimeout(
        (...callArgs: unknown[]) => {
          fired.add(handle)
          callback(...callArgs)
        },
        ms,
        ...args,
      )
      created.add(handle)
      return handle
    }) as typeof setTimeout)
    const realClearTimeout = globalThis.clearTimeout
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((handle) => {
      cleared.add(handle)
      realClearTimeout(handle)
    }) as typeof clearTimeout)

    let row = 0
    const res = await streamed(
      new ReadableStream({
        pull(controller) {
          if (row++ === 200) return controller.close()
          controller.enqueue(encoder.encode(`<tr><td>${row}</td></tr>`))
        },
      }),
    )
    await res.arrayBuffer()
    vi.restoreAllMocks()
    const left = [...created].filter(
      (handle) => !fired.has(handle) && !cleared.has(handle),
    )
    expect(created.size).toBeGreaterThan(0)
    expect(left).toEqual([])
  })

  it('errors the response when the source fails while a read is pending', async () => {
    const res = await streamed(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('<p>first</p>'))
          setTimeout(
            () => controller.error(new Error('source failed later')),
            20,
          )
        },
      }),
    )
    await expect(res.arrayBuffer()).rejects.toThrow()
  })
})
