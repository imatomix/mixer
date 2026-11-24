import {
  type Component,
  type Context,
  compose,
  type ExecutionContextLike,
  HttpError,
  Mixer,
  type Next,
  type State,
} from '@imatomix/mixer'
import type { Params } from './params.js'
import {
  compilePattern,
  decodePath,
  hasDynamicSegment,
  matchPattern,
  type Pattern,
  splitPath,
} from './pattern.js'

export type { Params } from './params.js'

export type RouteHandler<
  P = Record<string, string>,
  S extends State = State,
  E = unknown,
> = (ctx: Context<S, E>, params: P) => unknown

const dispatch = Symbol('dispatch')

type Dispatch<S extends State, E> = (
  ctx: Context<S, E>,
  prefix: string,
  next: Next,
) => Promise<unknown>

/** A route that can be passed to `mix()` as a mixer Component and nested in a namespace */
export interface Route<S extends State = State, E = unknown> {
  (ctx: Context<S, E>, next: Next): Promise<unknown>
  readonly [dispatch]: Dispatch<S, E>
}

function createRoute<S extends State, E>(run: Dispatch<S, E>): Route<S, E> {
  const component = (ctx: Context<S, E>, next: Next) => run(ctx, '', next)
  return Object.assign(component, { [dispatch]: run })
}

export function route<
  Path extends string,
  S extends State = State,
  E = unknown,
>(
  methods: string | readonly string[],
  path: Path,
  ...handlers: RouteHandler<Params<Path>, S, E>[]
): Route<S, E> {
  const allowed = new Set(
    (typeof methods === 'string' ? [methods] : methods).map((method) =>
      method.toUpperCase(),
    ),
  )
  if (allowed.has('GET')) allowed.add('HEAD')
  return createMatcher(path, handlers, allowed)
}

export function all<Path extends string, S extends State = State, E = unknown>(
  path: Path,
  ...handlers: RouteHandler<Params<Path>, S, E>[]
): Route<S, E> {
  return createMatcher(path, handlers, 'any')
}

function createMatcher<Path extends string, S extends State, E>(
  path: Path,
  handlers: RouteHandler<Params<Path>, S, E>[],
  methods: ReadonlySet<string> | 'any',
): Route<S, E> {
  // Cache the compiled pattern per namespace prefix instead of compiling it on every request
  const patterns = new Map<string, Pattern>()
  compilePattern(path)

  return createRoute(async (ctx, prefix) => {
    let pattern = patterns.get(prefix)
    if (!pattern) {
      pattern = compilePattern(prefix + path)
      patterns.set(prefix, pattern)
    }
    const segments = requestSegments(ctx)
    if (!segments) return undefined
    const params = matchPattern(pattern, segments)
    if (!params) return undefined

    const record = methodRecord(ctx)
    if (methods !== 'any' && !methods.has(ctx.method)) {
      for (const method of methods) record.allowed.add(method)
      return undefined
    }
    record.taken = true

    for (const handler of handlers) {
      const result = await handler(ctx, params as Params<Path>)
      if (result !== undefined) return result
    }
    return undefined
  })
}

type Decoded = { segments: string[] | undefined } | { error: unknown }

// Every route needs the decoded path, so decode it once per request and share the result
// (including a 400 for malformed encoding) between routes
const decodedPaths = new WeakMap<Context<State>, Decoded>()

function requestSegments<S extends State, E>(
  ctx: Context<S, E>,
): string[] | undefined {
  const key = ctx as unknown as Context<State>
  let decoded = decodedPaths.get(key)
  if (!decoded) {
    try {
      decoded = { segments: decodePath(ctx.path) }
    } catch (error) {
      decoded = { error }
    }
    decodedPaths.set(key, decoded)
  }
  if ('error' in decoded) throw decoded.error
  return decoded.segments
}

/** What the routes whose path matched found out about the method, for methodNotAllowed */
interface MethodRecord {
  allowed: Set<string>
  /** A route that takes this method (or any method) matched, so the answer is not 405 */
  taken: boolean
}

const methodRecords = new WeakMap<Context<State>, MethodRecord>()

function methodRecord<S extends State, E>(ctx: Context<S, E>): MethodRecord {
  const key = ctx as unknown as Context<State>
  let record = methodRecords.get(key)
  if (!record) {
    record = { allowed: new Set(), taken: false }
    methodRecords.set(key, record)
  }
  return record
}

/**
 * Mix it in after the routes. When a route's path matched but no route takes the request method, it answers
 * 405 with an Allow header listing the methods that are taken; otherwise it hands over (to 404).
 * OPTIONS is not answered by itself: add an options() route, or let mix-cors answer preflights
 */
export function methodNotAllowed<
  S extends State = State,
  E = unknown,
>(): Component<S, E> {
  return (ctx) => {
    const record = methodRecords.get(ctx as unknown as Context<State>)
    if (!record || record.taken || record.allowed.size === 0) return undefined
    throw new HttpError(405, 'Method Not Allowed', {
      headers: { Allow: [...record.allowed].join(', ') },
    })
  }
}

type MethodRoute = <Path extends string, S extends State = State, E = unknown>(
  path: Path,
  ...handlers: RouteHandler<Params<Path>, S, E>[]
) => Route<S, E>

function methodRoute(method: string): MethodRoute {
  return (path, ...handlers) => route(method, path, ...handlers)
}

/** Also responds to HEAD */
export const get = methodRoute('GET')
export const post = methodRoute('POST')
export const put = methodRoute('PUT')
export const patch = methodRoute('PATCH')
/** `del`, because `delete` is a reserved word */
export const del = methodRoute('DELETE')
export const head = methodRoute('HEAD')
export const options = methodRoute('OPTIONS')

export function namespace(prefix: string) {
  const scope = prefixScope('namespace', prefix)

  return <S extends State = State, E = unknown>(
    ...items: (Route<S, E> | Component<S, E>)[]
  ): Route<S, E> =>
    createRoute(async (ctx, outerPrefix, next) => {
      const prefix = scope.under(ctx, outerPrefix)
      // Nothing inside can match a path outside the prefix
      if (prefix === undefined) return undefined
      // The items run as one group, so next() inside wraps the rest of the namespace and what follows it
      const group = items.map(
        (item): Component<S, E> =>
          isRoute(item)
            ? (inner, innerNext) => item[dispatch](inner, prefix, innerNext)
            : item,
      )
      return compose(...group)(ctx, next)
    })
}

/** An app that answers a Web Request: an object with fetch, such as a Hono app, or a fetch function */
export type FetchHandler =
  | {
      fetch(
        request: Request,
        env: unknown,
        executionContext: ExecutionContextLike,
      ): Response | Promise<Response>
    }
  | ((
      request: Request,
      env: unknown,
      executionContext: ExecutionContextLike,
    ) => Response | Promise<Response>)

/**
 * Hands every request under the prefix, whatever its method, to a whole app: another mixer app (give it the full
 * mount path as basePath) or any fetch handler. The URL is passed as it is, with ctx.env, waitUntil, and the
 * client's address, which a plain call from a route would lose
 */
export function mount<S extends State = State, E = unknown>(
  prefix: string,
  // biome-ignore lint/suspicious/noExplicitAny: a mounted mixer app has its own State and Env types
  app: Mixer<any, any> | FetchHandler,
): Route<S, E> {
  const scope = prefixScope('mount', prefix)

  return createRoute(async (ctx, outerPrefix) => {
    if (scope.under(ctx, outerPrefix) === undefined) return undefined
    methodRecord(ctx).taken = true
    if (ctx.request.bodyUsed) {
      throw new Error(
        'mix-router: mount() got a request whose body was already read; read the body only inside the mounted app',
      )
    }
    const executionContext: ExecutionContextLike = {
      waitUntil: (promise) => ctx.waitUntil(promise),
    }
    if (app instanceof Mixer) {
      return app.handle(ctx.request, {
        env: ctx.env,
        executionContext,
        // The peer, not ctx.ip, so the mounted app applies its own trustedProxies; ctx.ip only when a platform
        // resolved the client without a peer address
        remoteAddress: ctx.remoteAddress,
        clientIp: ctx.remoteAddress === undefined ? ctx.ip : undefined,
      })
    }
    return typeof app === 'function'
      ? app(ctx.request, ctx.env, executionContext)
      : app.fetch(ctx.request, ctx.env, executionContext)
  })
}

/**
 * Matches a prefix and everything below it, compared like route paths (decoded, segment by segment), under the
 * prefixes of enclosing namespaces
 */
function prefixScope(kind: 'namespace' | 'mount', prefix: string) {
  // Prefix parameters would not appear in the handlers' params type, so they are forbidden to keep types and runtime values in sync
  if (hasDynamicSegment(prefix)) {
    throw new TypeError(
      `mix-router: :param and * cannot be used in a ${kind}() prefix: ${JSON.stringify(prefix)}`,
    )
  }
  const normalized = splitPath(prefix)
    .map((segment) => `/${segment}`)
    .join('')
  const scopes = new Map<string, Pattern>()

  return {
    /** The full prefix when the request is under it */
    under<S extends State, E>(
      ctx: Context<S, E>,
      outerPrefix: string,
    ): string | undefined {
      const full = outerPrefix + normalized
      let scope = scopes.get(full)
      if (!scope) {
        scope = compilePattern(`${full}/*`)
        scopes.set(full, scope)
      }
      const segments = requestSegments(ctx)
      return segments !== undefined &&
        matchPattern(scope, segments) !== undefined
        ? full
        : undefined
    },
  }
}

function isRoute<S extends State, E>(
  item: Route<S, E> | Component<S, E>,
): item is Route<S, E> {
  return dispatch in item
}

type MethodRouteOf<S extends State, E> = <Path extends string>(
  path: Path,
  ...handlers: RouteHandler<Params<Path>, S, E>[]
) => Route<S, E>

/** A set of route functions with fixed State and Env types */
export interface Router<S extends State, E = unknown> {
  get: MethodRouteOf<S, E>
  post: MethodRouteOf<S, E>
  put: MethodRouteOf<S, E>
  patch: MethodRouteOf<S, E>
  del: MethodRouteOf<S, E>
  head: MethodRouteOf<S, E>
  options: MethodRouteOf<S, E>
  all: MethodRouteOf<S, E>
  route: <Path extends string>(
    methods: string | readonly string[],
    path: Path,
    ...handlers: RouteHandler<Params<Path>, S, E>[]
  ) => Route<S, E>
  namespace: (
    prefix: string,
  ) => (...items: (Route<S, E> | Component<S, E>)[]) => Route<S, E>
  // biome-ignore lint/suspicious/noExplicitAny: a mounted mixer app has its own State and Env types
  mount: (prefix: string, app: Mixer<any, any> | FetchHandler) => Route<S, E>
}

/**
 * With `const { get } = createRouter<AppState, Env>()`, handlers get a typed `ctx.state` and `ctx.env`
 * (no need to write `get<'/path', AppState, Env>(...)`). Env defaults to unknown, as in mixer
 */
export function createRouter<S extends State = State, E = unknown>(): Router<
  S,
  E
> {
  return {
    get,
    post,
    put,
    patch,
    del,
    head,
    options,
    all,
    route,
    namespace,
    mount,
  }
}
