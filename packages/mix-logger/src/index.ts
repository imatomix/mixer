import type { Component } from '@imatomix/mixer'

export interface LogEntry {
  /** リクエストを受け取った時刻 */
  time: Date
  method: string
  /** パスのみ。クエリはキーにも秘密が入りうるので含めない */
  path: string
  status: number
  durationMs: number
  /** 応答の Content-Length ヘッダの値（宣言値。ストリームなどで未設定なら undefined） */
  contentLength?: number
  /** 応答を送り終える前に接続が切れた */
  aborted: boolean
}

export interface LoggerOptions {
  /** 記録の出力先。既定は formatLogEntry した 1 行を標準出力に書く */
  write?: (entry: LogEntry) => void | Promise<void>
}

/** できるだけ前に mix する（処理時間はこのコンポーネントが実行された時点から計る） */
export function logger(options: LoggerOptions = {}): Component {
  const write = options.write ?? writeToStdout

  return (ctx) => {
    const time = new Date()
    const startedAt = performance.now()
    const { res } = ctx
    let recorded = false

    // finish と close はどちらも来うるので、先に来た方で 1 回だけ記録する
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

/** ログの出力に失敗しても、応答やサーバには影響させない */
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

/** 改行やエスケープシーケンスで、偽の行や色付けをログに差し込ませない */
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
