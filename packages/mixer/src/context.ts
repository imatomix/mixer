import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { parseBody, readBuffer } from './body.js'
import { Cookies } from './cookies.js'
import { sendResponse } from './send.js'

export type State = Record<string, unknown>

export type BeforeSendHook = () => void | Promise<void>

export class Context<S extends State = State> {
  readonly req: IncomingMessage
  readonly res: ServerResponse
  readonly url: URL
  readonly method: string
  status = 200
  state: S = {} as S

  #bodyLimit: number
  #buffer: Promise<Buffer> | undefined
  #beforeSendHooks: BeforeSendHook[] = []
  #cookies: Cookies | undefined

  constructor(req: IncomingMessage, res: ServerResponse, bodyLimit: number) {
    this.req = req
    this.res = res
    this.url = parseRequestUrl(req.url ?? '/')
    this.method = req.method ?? 'GET'
    this.#bodyLimit = bodyLimit
  }

  /** Reads request cookies and sets Set-Cookie headers */
  get cookies(): Cookies {
    this.#cookies ??= new Cookies(this.req, this.res)
    return this.#cookies
  }

  get sent(): boolean {
    return this.res.headersSent || this.res.writableEnded
  }

  /** A stream can be read only once, so the result is cached to allow calling this any number of times */
  buffer(): Promise<Buffer> {
    this.#buffer ??= readBuffer(this.req, this.#bodyLimit)
    return this.#buffer
  }

  async text(): Promise<string> {
    return (await this.buffer()).toString('utf8')
  }

  async body<T = unknown>(): Promise<T> {
    return parseBody(await this.buffer(), this.req.headers['content-type']) as T
  }

  /**
   * Registers work to run right before `send()` responds (for example, setting cookies).
   * It does not run when a component responds by writing to `ctx.res` directly
   */
  onBeforeSend(hook: BeforeSendHook): void {
    this.#beforeSendHooks.push(hook)
  }

  async send(status: number, body?: unknown): Promise<void> {
    this.status = status
    // Take the hooks out first so that they do not run again when a hook fails and an error response is sent
    const hooks = this.#beforeSendHooks.splice(0)
    try {
      for (const hook of hooks) {
        await hook()
      }
    } catch (error) {
      // If this fails before sendResponse takes the stream, nothing closes it and file descriptors leak
      if (body instanceof Readable) body.destroy()
      throw error
    }
    await sendResponse(this.res, this.status, body)
  }
}

/**
 * The host name cannot be trusted, so a fixed host is used only to extract the path and query.
 * `new URL(target, base)` would treat `//admin/x` as a protocol-relative URL (host=admin),
 * so targets starting with `/` are concatenated as strings before parsing
 */
export function parseRequestUrl(target: string): URL {
  if (target.startsWith('/')) return new URL(`http://localhost${target}`)
  const url = new URL(target, 'http://localhost')
  return new URL(`http://localhost${url.pathname}${url.search}`)
}
