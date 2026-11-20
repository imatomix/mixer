import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { DEFAULT_BODY_LIMIT } from './body.js'
import { Context, type State } from './context.js'
import { HttpError } from './errors.js'

export type Component<S extends State = State> = (
  ctx: Context<S>,
) => unknown | Promise<unknown>

export type ErrorHandler<S extends State = State> = (
  error: unknown,
  ctx: Context<S>,
) => void | Promise<void>

export interface MixerOptions<S extends State = State> {
  /** リクエストボディの上限バイト数（デフォルト 3MB） */
  bodyLimit?: number
  onError?: ErrorHandler<S>
}

export class Mixer<S extends State = State> {
  readonly #components: Component<S>[] = []
  readonly #bodyLimit: number
  readonly #onError: ErrorHandler<S>
  #server: Server | undefined

  constructor(options: MixerOptions<S> = {}) {
    this.#bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT
    this.#onError = options.onError ?? defaultErrorHandler
  }

  mix(...components: Component<S>[]): this {
    this.#components.push(...components)
    return this
  }

  readonly handler = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    let ctx: Context<S>
    try {
      ctx = new Context<S>(req, res, this.#bodyLimit)
    } catch {
      // 解析できないリクエストターゲット。ctx を作れないので onError は通さずに直接返す
      res.statusCode = 400
      res.end()
      return
    }
    try {
      await this.#run(ctx)
    } catch (error) {
      await this.#handleError(error, ctx)
    }
  }

  async #run(ctx: Context<S>): Promise<void> {
    for (const component of this.#components) {
      const result = await component(ctx)
      if (ctx.sent) return
      if (result !== undefined) {
        await ctx.send(ctx.status, result)
        return
      }
    }
    throw new HttpError(404)
  }

  async #handleError(error: unknown, ctx: Context<S>): Promise<void> {
    if (ctx.sent) {
      // ヘッダ送信後は正しいエラーレスポンスを返せないため接続ごと切る
      ctx.res.destroy(error instanceof Error ? error : undefined)
      return
    }
    try {
      await this.#onError(error, ctx)
    } catch (handlerError) {
      console.error(handlerError)
    }
    // onError が応答し忘れたり失敗したりしても、リクエストを宙ぶらりんにしない
    if (!ctx.sent) await defaultErrorHandler(error, ctx)
  }

  listen(port = 0, hostname?: string): Promise<Server> {
    if (this.#server?.listening) {
      return Promise.reject(new Error('Mixer is already listening'))
    }
    const server = createServer(this.handler)
    this.#server = server
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, hostname, () => {
        server.off('error', reject)
        resolve(server)
      })
    })
  }

  get address(): AddressInfo | undefined {
    const address = this.#server?.address()
    return typeof address === 'object' && address !== null ? address : undefined
  }

  close(): Promise<void> {
    const server = this.#server
    if (!server) return Promise.resolve()
    this.#server = undefined
    return new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeIdleConnections()
    })
  }
}

async function defaultErrorHandler(
  error: unknown,
  ctx: Context<State>,
): Promise<void> {
  if (error instanceof HttpError && error.expose) {
    await ctx.send(error.status, { error: error.message })
    return
  }
  console.error(error)
  const status = error instanceof HttpError ? error.status : 500
  await ctx.send(status, { error: 'Internal Server Error' })
}
