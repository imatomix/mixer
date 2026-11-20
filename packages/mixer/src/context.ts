import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseBody, readBuffer } from './body.js'
import { sendResponse } from './send.js'

export type State = Record<string, unknown>

export class Context<S extends State = State> {
  readonly req: IncomingMessage
  readonly res: ServerResponse
  readonly url: URL
  readonly method: string
  status = 200
  state: S = {} as S

  #bodyLimit: number
  #buffer: Promise<Buffer> | undefined

  constructor(req: IncomingMessage, res: ServerResponse, bodyLimit: number) {
    this.req = req
    this.res = res
    // ホスト名は信頼できないので、パスとクエリを取り出すためだけに固定のベースを使う
    this.url = new URL(req.url ?? '/', 'http://localhost')
    this.method = req.method ?? 'GET'
    this.#bodyLimit = bodyLimit
  }

  get sent(): boolean {
    return this.res.headersSent || this.res.writableEnded
  }

  /** ストリームは一度しか読めないので、結果をキャッシュして何度でも呼べるようにしている */
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

  send(status: number, body?: unknown): Promise<void> {
    this.status = status
    return sendResponse(this.res, status, body)
  }
}
