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

/** Where an error reported through ctx.onErrorReport() happened */
export type ErrorPhase =
  | 'handling'
  | 'onError'
  | 'beforeSend'
  | 'onResponse'
  | 'waitUntil'
  | 'streamCancel'

export interface ErrorReport {
  readonly error: unknown
  readonly phase: ErrorPhase
}

type BeforeSendHook = () => void | Promise<void>
type ResponseHook = (info: ResponseInfo) => void | Promise<void>
type ErrorListener = (report: ErrorReport) => void | Promise<void>

export interface ContextInit<E> {
  path: string
  bodyLimit: number
  env: E
  executionContext: ExecutionContextLike | undefined
  ip: string | undefined
  remoteAddress: string | undefined
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
  /**
   * The client's IP address: the direct peer, or behind trustedProxies the address from X-Forwarded-For, or one
   * the platform resolved (handle's clientIp). undefined when nothing supplied it (for example, through fetch).
   * It can be wrong behind a misconfigured proxy, NAT, or VPN, so do not use it alone to authorize
   */
  readonly ip: string | undefined
  /** The IP address of the direct peer (handle's remoteAddress), such as a reverse proxy */
  readonly remoteAddress: string | undefined

  #headers = new Headers()
  readonly #bodyLimit: number
  readonly #executionContext: ExecutionContextLike | undefined
  #bytes: Promise<Uint8Array> | undefined
  #cookies: Cookies | undefined
  #beforeSendHooks: BeforeSendHook[] = []
  readonly #responseHooks: ResponseHook[] = []
  readonly #errorListeners: ErrorListener[] = []
  #final = false

  constructor(request: Request, init: ContextInit<E>) {
    this.request = request
    // The host comes from the client's Host header and cannot be trusted; never use it for security decisions
    this.url = new URL(request.url)
    this.method = request.method
    this.path = init.path
    this.env = init.env
    this.ip = init.ip
    this.remoteAddress = init.remoteAddress
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
   * waitUntil; elsewhere it is not awaited. A failure is reported like any other error
   */
  waitUntil(promise: Promise<unknown>): void {
    const observed = promise.then(
      () => undefined,
      (error: unknown) => this.reportError(error, 'waitUntil'),
    )
    this.#executionContext?.waitUntil(observed)
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
    return (await parseBody(
      await this.bytes(),
      this.request.headers.get('content-type'),
    )) as T
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

  /**
   * Registers a listener for unexpected errors while handling this request, including those that onError turned
   * into a response and those after the response (onResponse hooks, waitUntil). HttpErrors below 500 are not
   * reported. Without a listener, mixer logs them with console.error together with the method and path
   */
  onErrorReport(listener: (report: ErrorReport) => void | Promise<void>): void {
    this.#errorListeners.push(listener)
  }

  /** @internal A failing listener is logged directly, so reporting never loops or affects the response */
  reportError(error: unknown, phase: ErrorPhase): void {
    if (this.#errorListeners.length === 0) {
      console.error(
        `mixer: ${this.method} ${this.url.pathname} (${phase})`,
        error,
      )
      return
    }
    for (const listener of this.#errorListeners) {
      try {
        const result = listener({ error, phase })
        if (result instanceof Promise) {
          const handled = result.catch((listenerError: unknown) =>
            console.error(listenerError),
          )
          // Like waitUntil work, so that a report sent over the network is not cut off after the response
          this.#executionContext?.waitUntil(handled)
        }
      } catch (listenerError) {
        console.error(listenerError)
      }
    }
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
        this.reportError(error, 'onResponse')
      }
    }
  }
}
