import type { Context, State } from '@imatomix/mixer'
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
> = (ctx: Context<S>, params: P) => unknown

const dispatch = Symbol('dispatch')

type Dispatch<S extends State> = (
  ctx: Context<S>,
  prefix: string,
) => Promise<unknown>

/** A route that can be passed to `mix()` as a mixer Component and nested in a namespace */
export interface Route<S extends State = State> {
  (ctx: Context<S>): Promise<unknown>
  readonly [dispatch]: Dispatch<S>
}

function createRoute<S extends State>(run: Dispatch<S>): Route<S> {
  const component = (ctx: Context<S>) => run(ctx, '')
  return Object.assign(component, { [dispatch]: run })
}

export function route<Path extends string, S extends State = State>(
  methods: string | readonly string[],
  path: Path,
  ...handlers: RouteHandler<Params<Path>, S>[]
): Route<S> {
  const allowed = new Set(
    (typeof methods === 'string' ? [methods] : methods).map((method) =>
      method.toUpperCase(),
    ),
  )
  if (allowed.has('GET')) allowed.add('HEAD')
  return createMatcher(path, handlers, (method) => allowed.has(method))
}

export function all<Path extends string, S extends State = State>(
  path: Path,
  ...handlers: RouteHandler<Params<Path>, S>[]
): Route<S> {
  return createMatcher(path, handlers, () => true)
}

function createMatcher<Path extends string, S extends State>(
  path: Path,
  handlers: RouteHandler<Params<Path>, S>[],
  acceptsMethod: (method: string) => boolean,
): Route<S> {
  // Cache the compiled pattern per namespace prefix instead of compiling it on every request
  const patterns = new Map<string, Pattern>()
  compilePattern(path)

  return createRoute(async (ctx, prefix) => {
    if (!acceptsMethod(ctx.method)) return undefined

    let pattern = patterns.get(prefix)
    if (!pattern) {
      pattern = compilePattern(prefix + path)
      patterns.set(prefix, pattern)
    }
    const segments = requestSegments(ctx)
    if (!segments) return undefined
    const params = matchPattern(pattern, segments)
    if (!params) return undefined

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

function requestSegments<S extends State>(
  ctx: Context<S>,
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

type MethodRoute = <Path extends string, S extends State = State>(
  path: Path,
  ...handlers: RouteHandler<Params<Path>, S>[]
) => Route<S>

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
  // Prefix parameters would not appear in the handlers' params type, so they are forbidden to keep types and runtime values in sync
  if (hasDynamicSegment(prefix)) {
    throw new Error(
      `:param and * cannot be used in a namespace path: ${prefix}`,
    )
  }
  const normalized = splitPath(prefix)
    .map((segment) => `/${segment}`)
    .join('')

  return <S extends State = State>(...routes: Route<S>[]): Route<S> =>
    createRoute(async (ctx, outerPrefix) => {
      for (const child of routes) {
        const result = await child[dispatch](ctx, outerPrefix + normalized)
        if (result !== undefined) return result
      }
      return undefined
    })
}

type MethodRouteOf<S extends State> = <Path extends string>(
  path: Path,
  ...handlers: RouteHandler<Params<Path>, S>[]
) => Route<S>

/** A set of route functions with a fixed State type */
export interface Router<S extends State> {
  get: MethodRouteOf<S>
  post: MethodRouteOf<S>
  put: MethodRouteOf<S>
  patch: MethodRouteOf<S>
  del: MethodRouteOf<S>
  head: MethodRouteOf<S>
  options: MethodRouteOf<S>
  all: MethodRouteOf<S>
  route: <Path extends string>(
    methods: string | readonly string[],
    path: Path,
    ...handlers: RouteHandler<Params<Path>, S>[]
  ) => Route<S>
  namespace: (prefix: string) => (...routes: Route<S>[]) => Route<S>
}

/**
 * With `const { get } = createRouter<AppState>()`, handlers get a typed `ctx.state`
 * (no need to write `get<'/path', AppState>(...)`)
 */
export function createRouter<S extends State = State>(): Router<S> {
  return { get, post, put, patch, del, head, options, all, route, namespace }
}
