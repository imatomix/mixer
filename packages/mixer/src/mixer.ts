import { DEFAULT_BODY_LIMIT } from './body.js'
import {
  Context,
  type ExecutionContextLike,
  internal,
  type State,
} from './context.js'
import { HttpError } from './errors.js'
import { finalizeResponse, NULL_BODY_STATUSES, toResponse } from './finalize.js'
import {
  normalizeIp,
  type ProxyRange,
  parseProxies,
  resolveClientIp,
} from './ip.js'

/**
 * Runs the components after this one and resolves to the Response they produced. An error they throw is already
 * turned into the error response (and kept in ctx.error), so next() does not reject
 */
export type Next = () => Promise<Response>

export type Component<S extends State = State, E = unknown> = (
  ctx: Context<S, E>,
  next: Next,
) => unknown | Promise<unknown>

/**
 * Returns a value to use as the error response, or undefined for the default one. ctx.state may be incomplete:
 * the error can come before the components that fill it ran, or from a request outside basePath that no
 * component saw, so its properties are optional here
 */
export type ErrorHandler<S extends State = State, E = unknown> = (
  error: unknown,
  ctx: Context<Partial<S>, E>,
) => unknown | Promise<unknown>

export interface MixerOptions<S extends State = State, E = unknown> {
  /** Path prefix the app is mounted at, such as '/api'. ctx.path does not include it */
  basePath?: string
  /** Maximum request body size in bytes (default 3 MB) */
  bodyLimit?: number
  /**
   * Reverse proxies whose X-Forwarded-For is trusted, as IP addresses or CIDR ranges such as `10.0.0.0/8`.
   * Without it, ctx.ip is the direct peer and X-Forwarded-For is ignored
   */
  trustedProxies?: readonly string[]
  onError?: ErrorHandler<S, E>
}

export interface HandleOptions<E = unknown> {
  env?: E | undefined
  executionContext?: ExecutionContextLike | undefined
  /**
   * The IP address of the direct peer (the socket), as Node and Bun report it. ctx.ip is resolved from it, with
   * X-Forwarded-For when it is one of trustedProxies
   */
  remoteAddress?: string | undefined
  /**
   * A client address the platform or framework has already resolved (Cloudflare's CF-Connecting-IP, SvelteKit's
   * getClientAddress()). Used as ctx.ip as it is, without reading X-Forwarded-For
   */
  clientIp?: string | undefined
}

export class Mixer<S extends State = State, E = unknown> {
  readonly #components: Component<S, E>[] = []
  readonly #basePath: string
  readonly #bodyLimit: number
  readonly #trustedProxies: ProxyRange[]
  readonly #onError: ErrorHandler<S, E> | undefined

  constructor(options: MixerOptions<S, E> = {}) {
    this.#basePath = normalizeBasePath(options.basePath)
    const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT
    // NaN or Infinity would make every size check pass and silently remove the limit
    if (!Number.isSafeInteger(bodyLimit) || bodyLimit < 0) {
      throw new RangeError(
        `bodyLimit must be an integer of 0 or more (bytes): ${bodyLimit}`,
      )
    }
    this.#bodyLimit = bodyLimit
    this.#trustedProxies = parseProxies(options.trustedProxies ?? [])
    this.#onError = options.onError
  }

  mix(...components: Component<S, E>[]): this {
    this.#components.push(...components)
    return this
  }

  /** Handles a request. Defined as a property so that it can be passed around without its object */
  readonly fetch = (
    request: Request,
    env?: E,
    executionContext?: ExecutionContextLike,
  ): Promise<Response> => this.handle(request, { env, executionContext })

  /**
   * Handles a request like fetch, with the connection details an adapter knows (the peer's address). Defined as
   * a property so that it can be passed around without its object
   */
  readonly handle = async (
    request: Request,
    { env, executionContext, remoteAddress, clientIp }: HandleOptions<E> = {},
  ): Promise<Response> => {
    const pathname = new URL(request.url).pathname
    const path = stripBasePath(pathname, this.#basePath)
    const peer =
      remoteAddress === undefined ? undefined : normalizeIp(remoteAddress)
    const ctx = new Context<S, E>(request, {
      path: path ?? pathname,
      bodyLimit: this.#bodyLimit,
      env: env as E,
      executionContext,
      remoteAddress: peer,
      // An address the platform resolved is final; only a direct peer goes through trustedProxies
      ip:
        clientIp === undefined
          ? resolveClientIp(
              peer,
              request.headers.get('x-forwarded-for'),
              this.#trustedProxies,
            )
          : normalizeIp(clientIp),
    })

    const notFound: Next = () => this.#respondToError(new HttpError(404), ctx)
    internal.setRunner(ctx, (list, end) => this.#dispatch(ctx, list, 0, end))
    let response =
      path === undefined
        ? await notFound()
        : await this.#dispatch(ctx, this.#components, 0, notFound)
    response = finalizeResponse(response, ctx.method)
    internal.finish(ctx)
    return response
  }

  /**
   * Runs the components from index on and always resolves to a Response: an error is turned into the error
   * response here, so a component that wrapped this part with next() receives a Response, never a rejection
   */
  async #dispatch(
    ctx: Context<S, E>,
    list: readonly Component<S, E>[],
    index: number,
    end: Next,
  ): Promise<Response> {
    for (let i = index; i < list.length; i++) {
      const component = list[i] as Component<S, E>
      let called = false
      let returned = false
      let inner: Response | undefined
      const next: Next = async () => {
        if (returned) {
          throw new Error(
            'mixer: next() was called after the component returned',
          )
        }
        if (called) throw new Error('mixer: next() was called more than once')
        called = true
        const response = await this.#dispatch(ctx, list, i + 1, end)
        // The component already returned (it did not await next()), so this response is never sent
        if (returned) {
          cancelBody(response, ctx)
          return response
        }
        inner = response
        return inner
      }

      let response: Response | undefined
      try {
        let result: unknown
        try {
          result = await component(ctx, next)
        } finally {
          returned = true
        }
        response = this.#outcome(ctx, result, called, inner)
        if (response === undefined) continue
        response = this.#accept(ctx, response)
      } catch (error) {
        response = this.#accept(ctx, await this.#respondToError(error, ctx))
      }
      // The rest produced a response that is not sent (replaced, or an error came after it)
      if (inner && inner.body !== response.body) cancelBody(inner, ctx)
      return response
    }
    return this.#accept(ctx, await end())
  }

  /**
   * What a component's result means: undefined goes on (unless it called next()), and anything else becomes the
   * response at this level. Misuse throws, so that it is answered as an error
   */
  #outcome(
    ctx: Context<S, E>,
    result: unknown,
    called: boolean,
    inner: Response | undefined,
  ): Response | undefined {
    if (!called) {
      if (result === undefined) return undefined
      // A Response this request already made (for example, by compose()) is final; anything else is turned into one
      if (result instanceof Response && ownedBy.get(result) === ctx) {
        return result
      }
      return this.#respond(ctx, result)
    }
    if (inner === undefined) {
      // The rest is still running: the component returned without awaiting next()
      throw new Error('mixer: await next() before returning')
    }
    if (result === undefined) {
      // ctx.status changed after next() applies to the response the component kept
      return ctx.status === inner.status
        ? inner
        : withStatus(inner, ctx.status, ctx)
    }
    // A value would be encoded with the headers of the response it replaces (Content-Type, Content-Length),
    // so a component that wrapped the rest either keeps that response or returns a whole new Response
    if (!(result instanceof Response)) {
      throw new Error(
        'mixer: after next(), return nothing or a Response, not another value',
      )
    }
    return result
  }

  /**
   * The one way a response leaves a component: its body must still be unread, it becomes this request's own
   * (copied when it came from elsewhere or has immutable headers), and ctx.headers and ctx.status follow it
   */
  #accept(ctx: Context<S, E>, response: Response): Response {
    if (response.bodyUsed || response.body?.locked) {
      throw new Error('mixer: the response body was already read')
    }
    let accepted = response
    if (ownedBy.get(response) !== ctx) {
      accepted = own(
        ctx,
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        }),
      )
    }
    internal.adopt(ctx, accepted)
    return accepted
  }

  #respond(ctx: Context<S, E>, value: unknown): Response {
    return own(ctx, toResponse(value, internal.draft(ctx), ctx.url.pathname))
  }

  async #respondToError(error: unknown, ctx: Context<S, E>): Promise<Response> {
    const status = error instanceof HttpError ? error.status : 500
    // ctx.error === undefined means success, so a thrown undefined must still show as a failure
    internal.setError(
      ctx,
      error === undefined ? new Error('A component threw undefined') : error,
    )
    if (status >= 500) internal.reportError(ctx, error, 'handling')
    // Error responses start from fresh headers: what the failed part meant for its response must not leak.
    // Headers every response needs are added by the components wrapping this one, after their next()
    const errorHeaders = () =>
      new Headers(error instanceof HttpError ? error.headers : undefined)
    internal.resetDraft(ctx, { status, headers: errorHeaders() })

    let failed = false
    if (this.#onError) {
      try {
        const value = await this.#onError(error, ctx)
        if (value !== undefined) return this.#respond(ctx, value)
      } catch (handlerError) {
        internal.reportError(ctx, handlerError, 'onError')
        failed = true
      }
      // When onError itself fails, the answer is a 500, whatever the original error was
      internal.resetDraft(ctx, {
        status: failed ? 500 : status,
        headers: failed ? new Headers() : errorHeaders(),
      })
    }
    const body =
      !failed && error instanceof HttpError && error.expose
        ? { error: error.message }
        : { error: 'Internal Server Error' }
    return own(ctx, toResponse(body, internal.draft(ctx)))
  }
}

/**
 * Runs components as one group, by the same rules as the app: next() inside runs the rest of the group, then
 * whatever follows the group. Routers build groups such as namespaces with it
 */
export function compose<S extends State = State, E = unknown>(
  ...components: Component<S, E>[]
): Component<S, E> {
  return (ctx, next) =>
    internal.run(ctx as Context, components as Component[], next)
}

/**
 * The responses this request made itself, which have mutable headers. Any other, including one from another mixer
 * app or another request, is copied and treated like a Response a component returned
 */
const ownedBy = new WeakMap<Response, Context<State, unknown>>()

function own(ctx: Context<State, unknown>, response: Response): Response {
  ownedBy.set(response, ctx)
  return response
}

function withStatus(
  response: Response,
  status: number,
  ctx: Context<State, unknown>,
): Response {
  const nullBody = NULL_BODY_STATUSES.has(status)
  if (nullBody) cancelBody(response, ctx)
  return new Response(nullBody ? null : response.body, {
    status,
    headers: response.headers,
  })
}

function cancelBody(response: Response, ctx: Context<State, unknown>): void {
  // A locked body was handed on (for example, piped through a compression stream), so it is not ours to cancel
  if (response.body?.locked) return
  response.body
    ?.cancel()
    .catch((error: unknown) => internal.reportError(ctx, error, 'streamCancel'))
}

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath) return ''
  const segments = basePath.split('/').filter(Boolean)
  return segments.length === 0 ? '' : `/${segments.join('/')}`
}

/** Removes basePath from the path, comparing whole segments. undefined when the path is outside it */
function stripBasePath(pathname: string, basePath: string): string | undefined {
  if (!basePath) return pathname
  if (pathname === basePath || pathname === `${basePath}/`) return '/'
  if (pathname.startsWith(`${basePath}/`))
    return pathname.slice(basePath.length)
  return undefined
}
