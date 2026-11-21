import type { Component } from '@imatomix/mixer'

export interface LogEntry {
  /** When the request was received */
  time: Date
  method: string
  /** Path only, including basePath. The query is left out because even its keys may contain secrets */
  path: string
  status: number
  /** From when this component ran until the Response was ready. Sending the body is not included */
  responseDurationMs: number
  /** Value of the response's Content-Length header (undefined when the length is unknown, such as for streams) */
  contentLength?: number
}

export interface LoggerOptions {
  /**
   * Where entries are written. Defaults to one formatLogEntry line through console.log.
   * A returned Promise is not awaited; it is handed to ctx.waitUntil so that serverless runtimes keep it alive
   */
  write?: (entry: LogEntry) => void | Promise<void>
}

/** Mix it in as early as possible (the duration is measured from when this component runs) */
export function logger(options: LoggerOptions = {}): Component {
  const write = options.write ?? writeToConsole

  return (ctx) => {
    const time = new Date()
    const startedAt = performance.now()

    ctx.onResponse(({ status, headers }) => {
      const contentLength = Number(headers.get('Content-Length') ?? Number.NaN)
      const entry: LogEntry = {
        time,
        method: ctx.method,
        path: ctx.url.pathname,
        status,
        responseDurationMs: performance.now() - startedAt,
        ...(Number.isFinite(contentLength) ? { contentLength } : {}),
      }
      const pending = safely(() => write(entry))
      if (pending) ctx.waitUntil(pending)
    })
    return undefined
  }
}

export function formatLogEntry(entry: LogEntry): string {
  const parts = [
    entry.time.toISOString(),
    escapeControlCharacters(entry.method),
    escapeControlCharacters(entry.path),
    String(entry.status),
    `${entry.responseDurationMs.toFixed(1)}ms`,
  ]
  if (entry.contentLength !== undefined) parts.push(`${entry.contentLength}B`)
  return parts.join(' ')
}

function writeToConsole(entry: LogEntry): void {
  console.log(formatLogEntry(entry))
}

/** Failing to write a log entry must not affect the response or the server */
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
