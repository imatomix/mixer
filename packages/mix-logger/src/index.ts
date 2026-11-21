import type { Component } from '@imatomix/mixer'

export interface LogEntry {
  /** When the request was received */
  time: Date
  method: string
  /** Path only. The query is left out because even its keys may contain secrets */
  path: string
  status: number
  durationMs: number
  /** Value of the response's Content-Length header (as declared; undefined when not set, such as for streams) */
  contentLength?: number
  /** The connection closed before the response was fully sent */
  aborted: boolean
}

export interface LoggerOptions {
  /** Where entries are written. Defaults to one formatLogEntry line on standard output */
  write?: (entry: LogEntry) => void | Promise<void>
}

/** Mix it in as early as possible (the duration is measured from when this component runs) */
export function logger(options: LoggerOptions = {}): Component {
  const write = options.write ?? writeToStdout

  return (ctx) => {
    const time = new Date()
    const startedAt = performance.now()
    const { res } = ctx
    let recorded = false

    // Both finish and close can fire, so record once on whichever comes first
    const record = () => {
      if (recorded) return
      recorded = true
      const contentLength = Number(res.getHeader('Content-Length'))
      const entry: LogEntry = {
        time,
        method: ctx.method,
        path: ctx.url.pathname,
        status: res.statusCode,
        durationMs: performance.now() - startedAt,
        aborted: !res.writableFinished,
        ...(Number.isFinite(contentLength) ? { contentLength } : {}),
      }
      safely(() => write(entry))
    }
    res.once('finish', record)
    res.once('close', record)
    return undefined
  }
}

export function formatLogEntry(entry: LogEntry): string {
  const parts = [
    entry.time.toISOString(),
    escapeControlCharacters(entry.method),
    escapeControlCharacters(entry.path),
    String(entry.status),
    `${entry.durationMs.toFixed(1)}ms`,
  ]
  if (entry.contentLength !== undefined) parts.push(`${entry.contentLength}B`)
  if (entry.aborted) parts.push('aborted')
  return parts.join(' ')
}

function writeToStdout(entry: LogEntry): void {
  process.stdout.write(`${formatLogEntry(entry)}\n`)
}

/** Failing to write a log entry must not affect the response or the server */
function safely(run: () => void | Promise<void>): void {
  try {
    const result = run()
    if (result instanceof Promise) {
      result.catch((error: unknown) => console.error('mix-logger:', error))
    }
  } catch (error) {
    console.error('mix-logger:', error)
  }
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
