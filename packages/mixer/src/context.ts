import { isForm, isJson, parseForm, parseJson, readBytes } from './body.js'
import { Cookies } from './cookies.js'
import { HttpError } from './errors.js'
import type { Draft } from './finalize.js'

export type State = Record<string, unknown>

/** The part of a Cloudflare Workers ExecutionContext that mixer uses */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
}

/** Where an error reported through ctx.onErrorReport() happened */
export type ErrorPhase = 'handling' | 'onError' | 'waitUntil' | 'streamCancel'

export interface ErrorReport {
  readonly error: unknown
  readonly phase: ErrorPhase
}

type ErrorListener = (report: ErrorReport) => void | Promise<void>

export interface ContextInit<E> {
  path: string
  bodyLimit: number
  env: E
  executionContext: ExecutionContextLike | undefined
  ip: string | undefined
  remoteAddress: string | undefined
}

/**
 * What mixer runs on a Context while answering. Filled in by Context's static block, so these reach its private
 * parts; the package's entry point does not export it, so it is not part of the public API
 */
export interface ContextInternals {
  draft(ctx: Context): Draft
  resetDraft(ctx: Context, draft: Draft): void
  setError(ctx: Context, error: unknown): void
  /** From now on, ctx.headers and ctx.status are those of this response, which has mutable headers */
  adopt(ctx: Context, response: Response): void
  /** The response is final: setting cookies now throws */
  finish(ctx: Context): void
  /** Lets compose() run a group by the app's rules (its error handling included) */
  setRunner(ctx: Context, runner: Runner): void
  run(
    ctx: Context,
    list: readonly ((ctx: Context, next: () => Promise<Response>) => unknown)[],
    end: () => Promise<Response>,
  ): Promise<Response>
  reportError(ctx: Context, error: unknown, phase: ErrorPhase): void
}

type Runner = (
  list: readonly ((ctx: Context, next: () => Promise<Response>) => unknown)[],
  end: () => Promise<Response>,
) => Promise<Response>

export const internal = {} as ContextInternals

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
  /**
   * The error that a later component threw, once mixer has turned it into the error response. A component that
   * wraps the rest with next() reads it after next() resolves; undefined when nothing failed
   */
  get error(): unknown {
    return this.#error
  }

  #error: unknown
  #runner: Runner | undefined
  #headers = new Headers()
  readonly #bodyLimit: number
  readonly #executionContext: ExecutionContextLike | undefined
  #bytes: Promise<Uint8Array> | undefined
  #cookies: Cookies | undefined
  readonly #errorListeners: ErrorListener[] = []
  #final = false

  constructor(request: Request, init: ContextInit<E>) {
    this.request = request
    // The host comes from the request's Host header, which any client can set: never build links or redirects
    // from it, or trust it to identify the server. (A browser cannot change it, which is why mix-csrf may compare
    // a browser's Origin with it)
    this.url = new URL(request.url)
    this.method = request.method
    this.path = init.path
    this.env = init.env
    this.ip = init.ip
    this.remoteAddress = init.remoteAddress
    this.#bodyLimit = init.bodyLimit
    this.#executionContext = init.executionContext
  }

  /**
   * Headers of the response being made. After next() resolves, they are the headers of the Response it returned,
   * so a component that wraps the rest can add headers and cookies to it
   */
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
      (error: unknown) => this.#reportError(error, 'waitUntil'),
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

  /**
   * The body parsed as JSON. Only for application/json (or another +json type): anything else is 415 before the
   * body is read, so a JSON route cannot be reached by a form or text/plain that browsers send cross-site without
   * a preflight. The value is unknown: check it before use
   */
  async json(): Promise<unknown> {
    if (!isJson(this.request.headers.get('content-type'))) {
      throw new HttpError(415, 'Expected a JSON body')
    }
    return parseJson(await this.bytes())
  }

  /**
   * The body as FormData. Only for application/x-www-form-urlencoded and multipart/form-data: anything else is
   * 415 before the body is read. Values are strings, or Files for uploads; check them before use
   */
  async form(): Promise<FormData> {
    const contentType = this.request.headers.get('content-type')
    if (!isForm(contentType)) {
      throw new HttpError(415, 'Expected a form body')
    }
    return parseForm(await this.bytes(), contentType ?? '')
  }

  /**
   * Registers a listener for unexpected errors while handling this request, including those that onError turned
   * into a response and those after the response (waitUntil). HttpErrors below 500 are not
   * reported. Without a listener, mixer logs them with console.error together with the method and path
   */
  onErrorReport(listener: (report: ErrorReport) => void | Promise<void>): void {
    this.#errorListeners.push(listener)
  }

  static {
    Object.assign(internal, {
      draft: (ctx: Context) => ctx.#draft(),
      resetDraft: (ctx: Context, draft: Draft) => ctx.#resetDraft(draft),
      setError: (ctx: Context, error: unknown) => {
        ctx.#error = error
      },
      adopt: (ctx: Context, response: Response) => {
        ctx.status = response.status
        ctx.#headers = response.headers
      },
      finish: (ctx: Context) => {
        ctx.#final = true
        // Work still running (a next() that was not awaited) must not change the response already returned
        ctx.#headers = new Headers()
        ctx.#runner = undefined
      },
      setRunner: (ctx: Context, runner: Runner) => {
        ctx.#runner = runner
      },
      run: (ctx, list, end) => {
        if (!ctx.#runner) {
          throw new Error('mixer: compose() runs only inside a mixer app')
        }
        return ctx.#runner(list, end)
      },
      reportError: (ctx: Context, error: unknown, phase: ErrorPhase) =>
        ctx.#reportError(error, phase),
    } satisfies ContextInternals)
  }

  /** A failing listener is logged directly, so reporting never loops or affects the response */
  #reportError(error: unknown, phase: ErrorPhase): void {
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

  #draft(): Draft {
    return { status: this.status, headers: this.#headers }
  }

  /** Replaces the draft, for error responses */
  #resetDraft(draft: Draft): void {
    this.status = draft.status
    this.#headers = draft.headers
  }
}
