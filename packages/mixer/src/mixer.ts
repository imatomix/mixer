import { DEFAULT_BODY_LIMIT } from './body.js'
import { Context, type ExecutionContextLike, type State } from './context.js'
import { HttpError } from './errors.js'
import { errorDraft, finalizeResponse, toResponse } from './finalize.js'

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
  onError?: ErrorHandler<S, E>
}

export class Mixer<S extends State = State, E = unknown> {
  readonly #components: Component<S, E>[] = []
  readonly #basePath: string
  readonly #bodyLimit: number
  readonly #onError: ErrorHandler<S, E> | undefined

  constructor(options: MixerOptions<S, E> = {}) {
    this.#basePath = normalizeBasePath(options.basePath)
    this.#bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT
    this.#onError = options.onError
  }

  mix(...components: Component<S, E>[]): this {
    this.#components.push(...components)
    return this
  }

  /** Handles a request. Defined as a property so that it can be passed around without its object */
  readonly fetch = async (
    request: Request,
    env?: E,
    executionContext?: ExecutionContextLike,
  ): Promise<Response> => {
    const pathname = new URL(request.url).pathname
    const path = stripBasePath(pathname, this.#basePath)
    const ctx = new Context<S, E>(request, {
      path: path ?? pathname,
      bodyLimit: this.#bodyLimit,
      env: env as E,
      executionContext,
    })

    let response: Response
    try {
      if (path === undefined) throw new HttpError(404)
      response = await this.#respond(ctx, await this.#run(ctx))
    } catch (error) {
      response = await this.#respondToError(error, ctx)
    }

    const final = finalizeResponse(response, ctx.method)
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
      cancelBody(value)
      throw error
    }
    return toResponse(value, ctx.draft, ctx.url.pathname)
  }

  async #respondToError(error: unknown, ctx: Context<S, E>): Promise<Response> {
    const status = error instanceof HttpError ? error.status : 500
    const draft = errorDraft(ctx.headers, status)
    ctx.resetDraft(draft)

    if (this.#onError) {
      let value: unknown
      try {
        value = await this.#onError(error, ctx)
      } catch (handlerError) {
        console.error(handlerError)
      }
      // A failure while sending onError's value is a hook failure, not an onError failure, so it is a 500
      if (value !== undefined) {
        try {
          return await this.#respond(ctx, value)
        } catch (hookError) {
          return respondToHookFailure(hookError, ctx)
        }
      }
      ctx.resetDraft(errorDraft(draft.headers, status))
    }

    try {
      await ctx.runBeforeSend()
    } catch (hookError) {
      return respondToHookFailure(hookError, ctx)
    }
    return defaultErrorResponse(error, ctx)
  }
}

function respondToHookFailure(
  error: unknown,
  ctx: Context<State, unknown>,
): Response {
  console.error(error)
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
  console.error(error)
  return toResponse({ error: 'Internal Server Error' }, ctx.draft)
}

function cancelBody(value: unknown): void {
  const stream =
    value instanceof ReadableStream
      ? value
      : value instanceof Response
        ? value.body
        : null
  stream?.cancel().catch((error: unknown) => console.error(error))
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
