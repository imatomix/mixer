import { parseBody, readBytes } from './body.js'
import { Cookies } from './cookies.js'
import type { Draft } from './finalize.js'

export type State = Record<string, unknown>

/** The part of a Cloudflare Workers ExecutionContext that mixer uses */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
}

/** A snapshot of the final response passed to onResponse hooks. Changing it has no effect */
export interface ResponseInfo {
  readonly status: number
  readonly headers: Headers
}

type BeforeSendHook = () => void | Promise<void>
type ResponseHook = (info: ResponseInfo) => void | Promise<void>

export interface ContextInit<E> {
  path: string
  bodyLimit: number
  env: E
  executionContext: ExecutionContextLike | undefined
}

export class Context<S extends State = State, E = unknown> {
  readonly request: Request
  readonly url: URL
  readonly method: string
  /** The request path without basePath. Routing and file serving use this */
  readonly path: string
  /** Status of the response draft (default 200) */
  status = 200
  state: S = {} as S
  /** Bindings passed to fetch(), such as Cloudflare Workers environment variables */
  readonly env: E

  #headers = new Headers()
  readonly #bodyLimit: number
  readonly #executionContext: ExecutionContextLike | undefined
  #bytes: Promise<Uint8Array> | undefined
  #cookies: Cookies | undefined
  #beforeSendHooks: BeforeSendHook[] = []
  readonly #responseHooks: ResponseHook[] = []
  #final = false

  constructor(request: Request, init: ContextInit<E>) {
    this.request = request
    // The host comes from the client's Host header and cannot be trusted; never use it for security decisions
    this.url = new URL(request.url)
    this.method = request.method
    this.path = init.path
    this.env = init.env
    this.#bodyLimit = init.bodyLimit
    this.#executionContext = init.executionContext
  }

  /** Headers of the response draft. Changes after the response is final have no effect */
  get headers(): Headers {
    return this.#headers
  }

  /** Reads request cookies and adds Set-Cookie headers to the draft */
  get cookies(): Cookies {
    this.#cookies ??= new Cookies(
      this.request.headers,
      () => this.#headers,
      () => this.#final,
    )
    return this.#cookies
  }

  /**
   * Keeps background work alive after the response. On Cloudflare Workers it is passed to
   * waitUntil; elsewhere it is not awaited, and a failure is only logged
   */
  waitUntil(promise: Promise<unknown>): void {
    if (this.#executionContext) {
      this.#executionContext.waitUntil(promise)
      return
    }
    promise.catch((error: unknown) => console.error(error))
  }

  /** A stream can be read only once, so the result is cached to allow calling this any number of times */
  bytes(): Promise<Uint8Array> {
    this.#bytes ??= readBytes(this.request, this.#bodyLimit)
    return this.#bytes
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.bytes())
  }

  async body<T = unknown>(): Promise<T> {
    return parseBody(
      await this.bytes(),
      this.request.headers.get('content-type'),
    ) as T
  }

  /** Registers work to run right before the final Response is built (for example, setting cookies) */
  onBeforeSend(hook: () => void | Promise<void>): void {
    this.#beforeSendHooks.push(hook)
  }

  /**
   * Registers work to run once the final Response is ready, before fetch() resolves.
   * Keep hooks short; pass slow asynchronous work to ctx.waitUntil()
   */
  onResponse(hook: (info: ResponseInfo) => void | Promise<void>): void {
    this.#responseHooks.push(hook)
  }

  /** @internal */
  get draft(): Draft {
    return { status: this.status, headers: this.#headers }
  }

  /** @internal Replaces the draft, for error responses */
  resetDraft(draft: Draft): void {
    this.status = draft.status
    this.#headers = draft.headers
  }

  /** @internal Runs the onBeforeSend hooks once; hooks are taken out first so they never run twice */
  async runBeforeSend(): Promise<void> {
    const hooks = this.#beforeSendHooks.splice(0)
    for (const hook of hooks) await hook()
  }

  /** @internal */
  async runOnResponse(response: Response): Promise<void> {
    this.#final = true
    for (const hook of this.#responseHooks) {
      try {
        await hook({
          status: response.status,
          headers: new Headers(response.headers),
        })
      } catch (error) {
        console.error(error)
      }
    }
  }
}
