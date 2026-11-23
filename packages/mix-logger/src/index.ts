import type { Component, Context, ErrorPhase } from '@imatomix/mixer'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface SerializedError {
  name?: string
  message: string
  stack?: string
}

/** One thing that happened while handling a request. Every event of a request has the same requestId */
export interface LogEvent {
  time: Date
  level: LogLevel
  /** `access`: the response, once per request. `app`: written through ctx.state.log. `error`: an unexpected error */
  kind: 'access' | 'app' | 'error'
  requestId: string
  method: string
  /** Path only, including basePath. The query is left out because even its keys may contain secrets */
  path: string
  /** For `app` events */
  message?: string
  fields?: Record<string, unknown>
  /** For `access` events */
  status?: number
  /** From when the logger ran until the Response was ready. Sending the body is not included */
  durationMs?: number
  /** Value of the response's Content-Length header, when the length is known */
  contentLength?: number
  /** For `error` events */
  phase?: ErrorPhase
  error?: SerializedError
}

/** Writes events tied to the current request. Available as ctx.state.log */
export interface RequestLogger {
  readonly requestId: string
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}

/** Type of the value added to `ctx.state`. Use it as `Mixer<LoggerState>` */
export type LoggerState = { log: RequestLogger }

export interface LoggerOptions {
  /**
   * Where events go. `'json'` (default) writes one JSON object per line, and `'text'` one readable line, through
   * console.log (console.error for errors). A function receives each event; a returned Promise is not awaited but
   * handed to ctx.waitUntil, so that serverless runtimes keep it alive
   */
  write?: 'json' | 'text' | ((event: LogEvent) => void | Promise<void>)
  /**
   * Takes the request ID from the request, such as `(ctx) => ctx.request.headers.get('cf-ray') ?? undefined`.
   * A missing or malformed value (anything but 1 to 128 of `A-Z a-z 0-9 . _ : -`) gets a new random ID.
   * By default every request gets a new one, because clients can send any header
   */
  requestId?: (ctx: Context) => string | undefined
  /** Response header that carries the request ID, or false for none. Default `X-Request-Id` */
  header?: string | false
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/**
 * Gives every request an ID and ties everything logged while handling it to that ID: the access event, what
 * handlers write through ctx.state.log, and unexpected errors with their stack. Mix it in first
 */
export function logger(options: LoggerOptions = {}): Component {
  const write = toWriter(options.write ?? 'json')
  const header = options.header ?? 'X-Request-Id'
  if (header !== false && !TOKEN.test(header)) {
    throw new TypeError(
      `mix-logger: header must be a header name such as X-Request-Id, or false: ${JSON.stringify(header)}`,
    )
  }

  return (ctx) => {
    const time = new Date()
    const startedAt = performance.now()
    const chosen = options.requestId?.(ctx)
    const requestId =
      chosen !== undefined && REQUEST_ID.test(chosen)
        ? chosen
        : crypto.randomUUID()
    const base = { requestId, method: ctx.method, path: ctx.url.pathname }

    const emit = (event: LogEvent) => {
      const pending = safely(() => write(event))
      if (pending) ctx.waitUntil(pending)
    }
    const appEvent =
      (level: LogLevel) =>
      (message: string, fields?: Record<string, unknown>) =>
        emit({
          time: new Date(),
          level,
          kind: 'app',
          ...base,
          message,
          ...(fields ? { fields } : {}),
        })

    ;(ctx.state as LoggerState).log = {
      requestId,
      debug: appEvent('debug'),
      info: appEvent('info'),
      warn: appEvent('warn'),
      error: appEvent('error'),
    }
    ctx.onErrorReport(({ error, phase }) => {
      emit({
        time: new Date(),
        level: 'error',
        kind: 'error',
        ...base,
        phase,
        error: serializeError(error),
      })
    })
    if (header !== false) {
      ctx.onBeforeSend(() => {
        ctx.headers.set(header, requestId)
      })
    }
    ctx.onResponse(({ status, headers }) => {
      const contentLength = Number(headers.get('Content-Length') ?? Number.NaN)
      emit({
        time,
        level: 'info',
        kind: 'access',
        ...base,
        status,
        durationMs: performance.now() - startedAt,
        ...(Number.isFinite(contentLength) ? { contentLength } : {}),
      })
    })
    return undefined
  }
}

/** One readable line, with control characters escaped. An error's stack frames follow on their own lines */
export function formatLogEvent(event: LogEvent): string {
  const parts = [
    event.time.toISOString(),
    event.level.toUpperCase(),
    event.method,
    event.path,
  ]
  let frames = ''
  if (event.kind === 'access') {
    parts.push(String(event.status))
    if (event.durationMs !== undefined) {
      parts.push(`${event.durationMs.toFixed(1)}ms`)
    }
    if (event.contentLength !== undefined) parts.push(`${event.contentLength}B`)
  } else if (event.kind === 'error') {
    const { name, message, stack } = event.error ?? { message: '' }
    parts.push(`(${event.phase})`, name ? `${name}: ${message}` : message)
    // Frames come from the code that ran, not from the request, so they keep their line breaks
    frames = (stack ?? '')
      .split('\n')
      .filter((line) => /^\s+at /.test(line))
      .map((line) => `\n${escapeControlCharacters(line)}`)
      .join('')
  } else {
    parts.push(event.message ?? '')
    if (event.fields) parts.push(fieldsText(event.fields))
  }
  parts.push(event.requestId)
  return parts.map(escapeControlCharacters).join(' ') + frames
}

function toWriter(
  write: NonNullable<LoggerOptions['write']>,
): (event: LogEvent) => void | Promise<void> {
  if (typeof write === 'function') return write
  const format = write === 'text' ? formatLogEvent : formatJson
  return (event) => {
    const line = format(event)
    if (event.kind === 'error') console.error(line)
    else console.log(line)
  }
}

/** The fixed fields come last, so a handler's fields cannot replace the request ID or the level */
function formatJson({ fields, time, ...event }: LogEvent): string {
  const fixed = { ...event, time: time.toISOString() }
  try {
    return toJson({ ...fields, ...fixed })
  } catch {
    return toJson({ ...fixed, fields: 'unserializable' })
  }
}

/** Like JSON.stringify, but writes BigInts as strings and Errors with their name, message, and stack */
function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint'
      ? item.toString()
      : item instanceof Error
        ? serializeError(item)
        : item,
  )
}

function fieldsText(fields: Record<string, unknown>): string {
  try {
    return toJson(fields)
  } catch {
    return '{unserializable fields}'
  }
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }
  return { message: String(error) }
}

/** Failing to write an event must not affect the response or the server */
function safely(run: () => void | Promise<void>): Promise<void> | undefined {
  try {
    const result = run()
    if (result instanceof Promise) {
      return result.catch((error: unknown) => {
        console.error('mix-logger:', error)
      })
    }
  } catch (error) {
    console.error('mix-logger:', error)
  }
  return undefined
}

const ESCAPES: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
}

/** Keep newlines and escape sequences from forging lines or colors in the log */
function escapeControlCharacters(value: string): string {
  let escaped = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) {
      escaped += ESCAPES[char] ?? `\\x${code.toString(16).padStart(2, '0')}`
    } else {
      escaped += char
    }
  }
  return escaped
}
