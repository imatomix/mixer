import { type Context, internal, type State } from './context.js'

export interface SseMessage {
  /** Each line becomes its own `data:` line, so the text cannot end the event or start another one */
  data?: string
  event?: string
  id?: string
  /** Milliseconds the client waits before reconnecting */
  retry?: number
}

export interface SseStream {
  /**
   * Resolves when the client is ready for more, so awaiting each send keeps at most one event waiting in memory.
   * Rejects after the client has gone away
   */
  send(message: SseMessage): Promise<void>
}

export interface SseOptions {
  /**
   * Milliseconds without sending before a comment line is sent, so that Bun (10 seconds by default) and proxies
   * do not close an idle connection. Defaults to 5000; false sends none
   */
  heartbeat?: number | false
}

const DEFAULT_HEARTBEAT = 5_000
const HEARTBEAT = new TextEncoder().encode(':\n\n')
const LINE_BREAK = /\r\n|\r|\n/
const encoder = new TextEncoder()

/**
 * Answers with a stream of Server-Sent Events. The producer starts when the client reads the body (never for
 * HEAD), and `signal` is aborted when the client goes away. An error the producer throws is reported with the
 * phase 'stream', because the response has already started
 */
export function sse<S extends State, E>(
  ctx: Context<S, E>,
  producer: (stream: SseStream, signal: AbortSignal) => unknown,
  options: SseOptions = {},
): Response {
  const heartbeat = options.heartbeat ?? DEFAULT_HEARTBEAT
  if (heartbeat !== false && !(Number.isFinite(heartbeat) && heartbeat > 0)) {
    throw new RangeError(
      `sse heartbeat must be a positive number of milliseconds or false: ${heartbeat}`,
    )
  }

  const aborter = new AbortController()
  const signal = aborter.signal
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let started = false
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // Sends waiting for the client; a producer may await several at once (Promise.all)
  const waitingSends = new Set<() => void>()
  const resumeSends = () => {
    for (const resume of waitingSends) resume()
    waitingSends.clear()
  }

  const stop = (reason?: unknown) => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    if (!signal.aborted) aborter.abort(reason)
    resumeSends()
  }

  // A cancelled body is already closed; otherwise end it, so whoever still reads it is not left waiting
  const end = () => {
    try {
      controller.close()
    } catch {}
  }

  const armHeartbeat = () => {
    if (heartbeat === false || closed) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (closed) return
      // Something unread is already waiting, so the connection is not idle; a client that stopped reading
      // (a Worker that does not see the disconnect) must not make the queue grow
      if ((controller.desiredSize ?? 0) >= 0) controller.enqueue(HEARTBEAT)
      armHeartbeat()
    }, heartbeat)
  }

  const stream: SseStream = {
    async send(message) {
      const chunk = encoder.encode(format(message))
      if (closed) throw signal.reason ?? new Error('The event stream is closed')
      controller.enqueue(chunk)
      armHeartbeat()
      // A queued chunk means the client has not asked for more yet
      if ((controller.desiredSize ?? 0) < 0) {
        await new Promise<void>((resolve) => {
          waitingSends.add(resolve)
        })
        if (signal.aborted) throw signal.reason
      }
    },
  }

  const run = async () => {
    try {
      await producer(stream, signal)
    } catch (error) {
      // After the client left, errors are the expected way for the producer to stop
      if (!signal.aborted)
        internal.reportError(ctx as unknown as Context, error, 'stream')
    }
    stop()
    end()
  }

  const body = new ReadableStream<Uint8Array>(
    {
      start(streamController) {
        controller = streamController
      },
      pull() {
        if (!started) {
          started = true
          armHeartbeat()
          void run()
          return
        }
        resumeSends()
      },
      cancel(reason) {
        stop(reason)
      },
    },
    // Nothing is produced until the client reads, so HEAD and discarded bodies never start the producer
    { highWaterMark: 0 },
  )

  const leave = () => {
    stop(ctx.request.signal.reason)
    end()
  }
  if (ctx.request.signal.aborted) leave()
  else ctx.request.signal.addEventListener('abort', leave, { once: true })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function format(message: SseMessage): string {
  let text = ''
  if (message.id !== undefined)
    text += `id: ${field('id', message.id, /[\r\n\0]/)}\n`
  if (message.event !== undefined) {
    text += `event: ${field('event', message.event, /[\r\n]/)}\n`
  }
  if (message.retry !== undefined) {
    if (!Number.isInteger(message.retry) || message.retry < 0) {
      throw new TypeError(
        `sse retry must be a whole number of milliseconds, 0 or more: ${message.retry}`,
      )
    }
    text += `retry: ${message.retry}\n`
  }
  if (message.data !== undefined) {
    if (typeof message.data !== 'string') {
      throw new TypeError(
        'sse data must be a string; use JSON.stringify for other values',
      )
    }
    for (const line of message.data.split(LINE_BREAK)) text += `data: ${line}\n`
  }
  return `${text}\n`
}

function field(name: string, value: string, forbidden: RegExp): string {
  if (typeof value !== 'string' || forbidden.test(value)) {
    throw new TypeError(
      `sse ${name} must be a string without line breaks${name === 'id' ? ' or NUL' : ''}`,
    )
  }
  return value
}
