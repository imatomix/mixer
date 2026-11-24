import {
  type BrotliCompress,
  constants,
  createBrotliCompress,
  createGzip,
  type Gzip,
} from 'node:zlib'
import type { Component, Context, State } from '@imatomix/mixer'

export interface CompressOptions {
  /** A body whose length is known and shorter than this is sent as it is. Defaults to 1024 */
  minBytes?: number
  /**
   * Compress responses to requests that carry Cookie or Authorization. Off by default: a signed-in page that mixes
   * secrets with text an attacker can influence can leak them through its compressed size (BREACH)
   */
  allowCredentialed?: boolean
  /** Return false to send a response uncompressed */
  filter?: (ctx: Context, response: Response) => boolean
}

type Encoding = 'br' | 'gzip'

const DEFAULT_MIN_BYTES = 1024
// Quality 11, Brotli's default, is meant for files compressed once; responses are compressed on every request
const BROTLI_QUALITY = 4
// Output is flushed at least this often, so a source that never waits still reaches the client in parts
const BATCH_BYTES = 64 * 1024
const WAITING = Symbol('waiting')
const NO_BODY_STATUSES = new Set([204, 205, 206, 304])
const COMPRESSIBLE =
  /^(?:text\/(?!event-stream\b)|application\/(?:json|xml|javascript|ecmascript|x-javascript|[\w.-]+\+(?:json|xml))\b|image\/svg\+xml\b)/i

/**
 * Compresses responses with Brotli or gzip, for apps that Node.js or Bun serve directly. Mix it in early, so it
 * wraps the responses of everything after it. Streamed pages are flushed whenever the source waits, so they arrive
 * as they are produced
 */
export function compress<S extends State = State, E = unknown>(
  options: CompressOptions = {},
): Component<S, E> {
  const minBytes = options.minBytes ?? DEFAULT_MIN_BYTES
  if (!Number.isInteger(minBytes) || minBytes < 0) {
    throw new RangeError(
      `mix-compress: minBytes must be an integer of 0 or more: ${minBytes}`,
    )
  }
  const allowCredentialed = options.allowCredentialed ?? false
  const varyFields = allowCredentialed
    ? ['Accept-Encoding']
    : ['Accept-Encoding', 'Cookie', 'Authorization']

  return async (ctx, next) => {
    const response = await next()
    if (ctx.method === 'HEAD' || !mayCompress(response, minBytes)) return

    // Whether this response is compressed depends on these request headers, so caches must keep them apart
    addVary(ctx.headers, varyFields)

    const encoding = chooseEncoding(ctx.request.headers.get('accept-encoding'))
    if (!encoding) return
    const headers = ctx.request.headers
    if (
      !allowCredentialed &&
      (headers.has('cookie') || headers.has('authorization'))
    ) {
      return
    }
    if (
      options.filter &&
      !options.filter(ctx as unknown as Context, response)
    ) {
      return
    }

    const compressedHeaders = new Headers(ctx.headers)
    compressedHeaders.set('Content-Encoding', encoding)
    compressedHeaders.delete('Content-Length')
    return new Response(
      compressBody(response.body as ReadableStream<Uint8Array>, encoding),
      {
        status: response.status,
        statusText: response.statusText,
        headers: compressedHeaders,
      },
    )
  }
}

function mayCompress(response: Response, minBytes: number): boolean {
  if (
    !response.body ||
    response.body.locked ||
    NO_BODY_STATUSES.has(response.status)
  ) {
    return false
  }
  const headers = response.headers
  if (
    headers.has('content-range') ||
    headers.has('content-encoding') ||
    headers.has('etag') ||
    /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(headers.get('cache-control') ?? '')
  ) {
    return false
  }
  if (!COMPRESSIBLE.test(headers.get('content-type') ?? '')) return false
  const length = headers.get('content-length')
  return length === null || Number(length) >= minBytes
}

/** The preferred of br and gzip, or undefined when neither is wanted over the uncompressed body */
function chooseEncoding(header: string | null): Encoding | undefined {
  if (header === null) return undefined
  const weights = new Map<string, number>()
  for (const part of header.split(',')) {
    const [rawName, ...params] = part.split(';')
    const name = rawName?.trim().toLowerCase()
    if (!name) continue
    let weight = 1
    for (const param of params) {
      const [key, value] = param.split('=').map((s) => s.trim())
      if (key?.toLowerCase() === 'q') {
        const parsed = Number(value)
        weight = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 0
      }
    }
    weights.set(name, weight)
  }
  const wildcard = weights.get('*')
  const weightOf = (name: string) => weights.get(name) ?? wildcard ?? 0
  const br = weightOf('br')
  const gzip = weightOf('gzip')
  const best = Math.max(br, gzip)
  if (best === 0) return undefined
  // identity is acceptable unless excluded; prefer it only when the client ranks it higher
  const identity = weights.get('identity')
  if (identity !== undefined && identity > best) return undefined
  return br >= gzip ? 'br' : 'gzip'
}

function addVary(headers: Headers, fields: readonly string[]): void {
  const current = (headers.get('Vary') ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean)
  if (current.includes('*')) return
  const lower = new Set(current.map((field) => field.toLowerCase()))
  const added = fields.filter((field) => !lower.has(field.toLowerCase()))
  if (added.length > 0) headers.set('Vary', [...current, ...added].join(', '))
}

function createCompressor(encoding: Encoding): BrotliCompress | Gzip {
  return encoding === 'br'
    ? createBrotliCompress({
        params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
      })
    : createGzip()
}

/**
 * Compresses the source as the client reads, so a client that stops reading stops the source too
 */
function compressBody(
  source: ReadableStream<Uint8Array>,
  encoding: Encoding,
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  const compressor = createCompressor(encoding)
  const flushKind =
    encoding === 'br'
      ? constants.BROTLI_OPERATION_FLUSH
      : constants.Z_SYNC_FLUSH
  let output: Uint8Array[] = []
  let failure: unknown
  compressor.on('data', (chunk: Uint8Array) => output.push(chunk))
  compressor.on('error', (error) => {
    failure = error
  })

  const take = () => {
    const chunks = output
    output = []
    return chunks
  }

  const write = (chunk: Uint8Array) =>
    new Promise<void>((resolve, reject) => {
      compressor.write(chunk, (error) => (error ? reject(error) : resolve()))
    })
  const flush = () =>
    new Promise<void>((resolve, reject) => {
      compressor.flush(flushKind, () => (failure ? reject(failure) : resolve()))
    })
  const finish = () =>
    new Promise<void>((resolve, reject) => {
      compressor.once('end', resolve)
      compressor.once('error', reject)
      compressor.end()
    })

  // A read the source can answer at once resolves within microtasks, before a 0 ms timer. This is a heuristic for
  // "the source has to wait", not an exact signal
  const readOrWait = async (read: ReturnType<typeof reader.read>) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const waiting = new Promise<typeof WAITING>((resolve) => {
      timer = setTimeout(resolve, 0, WAITING)
    })
    try {
      return await Promise.race([read, waiting])
    } finally {
      clearTimeout(timer)
    }
  }
  let pendingRead: ReturnType<typeof reader.read> | undefined
  // Once the client has gone, the compressor is destroyed and must not be written, flushed, or ended: ending a
  // destroyed one never emits 'end'
  let cancelled = false

  return new ReadableStream<Uint8Array>({
    // Chunks the source has ready are compressed together; output is flushed when the source has to wait or after
    // BATCH_BYTES of input, so a stream arrives as it is produced without flushing every small chunk
    async pull(controller) {
      try {
        let written = 0
        for (;;) {
          const read = pendingRead ?? reader.read()
          pendingRead = undefined
          const result = written === 0 ? await read : await readOrWait(read)
          if (cancelled) return
          if (result === WAITING) {
            pendingRead = read
            break
          }
          if (result.done) {
            await finish()
            for (const chunk of take()) controller.enqueue(chunk)
            controller.close()
            return
          }
          await write(result.value)
          written += result.value.byteLength
          if (written >= BATCH_BYTES) break
        }
        await flush()
        if (cancelled) return
        for (const chunk of take()) controller.enqueue(chunk)
      } catch (error) {
        if (cancelled) return
        compressor.destroy()
        void reader.cancel(error).catch(() => {})
        controller.error(error)
      }
    },
    async cancel(reason) {
      cancelled = true
      compressor.destroy()
      await reader.cancel(reason)
    },
  })
}
