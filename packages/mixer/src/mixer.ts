import { DEFAULT_BODY_LIMIT } from './body.js'
import {
  Context,
  type ErrorPhase,
  type ExecutionContextLike,
  type State,
} from './context.js'
import { HttpError } from './errors.js'
import {
  errorDraft,
  finalizeResponse,
  joinVary,
  toResponse,
} from './finalize.js'
import {
  normalizeIp,
  type ProxyRange,
  parseProxies,
  resolveClientIp,
} from './ip.js'

export type Component<S extends State = State, E = unknown> = (
  ctx: Context<S, E>,
) => unknown | Promise<unknown>

/** Returns a value to use as the error response, or undefined for the default one */
export type ErrorHandler<S extends State = State, E = unknown> = (
  error: unknown,
  ctx: Context<S, E>,
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

    let response: Response
    try {
      if (path === undefined) throw new HttpError(404)
      response = await this.#respond(ctx, await this.#run(ctx))
    } catch (thrown) {
      response =
        thrown instanceof BeforeSendFailure
          ? await this.#respondToError(thrown.error, ctx, 'beforeSend')
          : await this.#respondToError(thrown, ctx, 'handling')
    }

    const final = finalizeResponse(
      ctx.applyResponseHeaders(response),
      ctx.method,
    )
    await ctx.runOnResponse(final)
    return final
  }

  async #run(ctx: Context<S, E>): Promise<unknown> {
    for (const component of this.#components) {
      const result = await component(ctx)
      if (result !== undefined) return result
    }
    throw new HttpError(404)
  }

  async #respond(ctx: Context<S, E>, value: unknown): Promise<Response> {
    try {
      await ctx.runBeforeSend()
    } catch (error) {
      // The value will never be sent, so release a stream it holds (for example, an open file)
      cancelBody(value, ctx)
      throw new BeforeSendFailure(error)
    }
    return toResponse(value, ctx.draft, ctx.url.pathname)
  }

  async #respondToError(
    error: unknown,
    ctx: Context<S, E>,
    phase: ErrorPhase,
  ): Promise<Response> {
    const status = error instanceof HttpError ? error.status : 500
    if (status >= 500) ctx.reportError(error, phase)
    const draft = errorDraft(ctx.headers, status)
    if (error instanceof HttpError) {
      addHeaders(draft.headers, error.headers, { cookies: true })
    }
    ctx.resetDraft(draft)

    if (this.#onError) {
      let value: unknown
      try {
        value = await this.#onError(error, ctx)
      } catch (handlerError) {
        ctx.reportError(handlerError, 'onError')
      }
      // A failure while sending onError's value is a hook failure, not an onError failure, so it is a 500
      if (value !== undefined) {
        try {
          return await this.#respond(ctx, value)
        } catch (thrown) {
          return thrown instanceof BeforeSendFailure
            ? respondToHookFailure(thrown.error, ctx, 'beforeSend')
            : respondToHookFailure(thrown, ctx, 'onError')
        }
      }
      const fresh = errorDraft(draft.headers, status)
      if (error instanceof HttpError) {
        addHeaders(fresh.headers, error.headers, { cookies: false })
      }
      ctx.resetDraft(fresh)
    }

    try {
      await ctx.runBeforeSend()
    } catch (hookError) {
      return respondToHookFailure(hookError, ctx, 'beforeSend')
    }
    return defaultErrorResponse(error, ctx)
  }
}

/**
 * Adds an HttpError's headers to an error draft. Vary is joined with what the draft kept (such as Origin from
 * mix-cors). Cookies are added only once: a draft rebuilt from one that already has them keeps them, together
 * with any change onError made to them
 */
function addHeaders(
  target: Headers,
  source: Headers,
  { cookies }: { cookies: boolean },
): void {
  for (const [name, value] of source) {
    if (name === 'set-cookie') continue
    if (name === 'vary') {
      const vary = joinVary(target.get('Vary'), value)
      if (vary) target.set('Vary', vary)
    } else {
      target.set(name, value)
    }
  }
  if (!cookies) return
  for (const cookie of source.getSetCookie())
    target.append('Set-Cookie', cookie)
}

/** Marks an error thrown by an onBeforeSend hook, so it is reported as such */
class BeforeSendFailure {
  constructor(readonly error: unknown) {}
}

function respondToHookFailure(
  error: unknown,
  ctx: Context<State, unknown>,
  phase: ErrorPhase,
): Response {
  ctx.reportError(error, phase)
  ctx.resetDraft(errorDraft(ctx.headers, 500))
  return toResponse({ error: 'Internal Server Error' }, ctx.draft)
}

function defaultErrorResponse(
  error: unknown,
  ctx: Context<State, unknown>,
): Response {
  if (error instanceof HttpError && error.expose) {
    return toResponse({ error: error.message }, ctx.draft)
  }
  return toResponse({ error: 'Internal Server Error' }, ctx.draft)
}

function cancelBody(value: unknown, ctx: Context<State, unknown>): void {
  const stream =
    value instanceof ReadableStream
      ? value
      : value instanceof Response
        ? value.body
        : null
  stream
    ?.cancel()
    .catch((error: unknown) => ctx.reportError(error, 'streamCancel'))
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
