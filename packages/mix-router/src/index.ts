import type { Component, Context, State } from '@imatomix/mixer'
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
) => Promise<unknown>

/** A route that can be passed to `mix()` as a mixer Component and nested in a namespace */
export interface Route<S extends State = State, E = unknown> {
  (ctx: Context<S, E>): Promise<unknown>
  readonly [dispatch]: Dispatch<S, E>
}

function createRoute<S extends State, E>(run: Dispatch<S, E>): Route<S, E> {
  const component = (ctx: Context<S, E>) => run(ctx, '')
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
  return createMatcher(path, handlers, (method) => allowed.has(method))
}

export function all<Path extends string, S extends State = State, E = unknown>(
  path: Path,
  ...handlers: RouteHandler<Params<Path>, S, E>[]
): Route<S, E> {
  return createMatcher(path, handlers, () => true)
}

function createMatcher<Path extends string, S extends State, E>(
  path: Path,
  handlers: RouteHandler<Params<Path>, S, E>[],
  acceptsMethod: (method: string) => boolean,
): Route<S, E> {
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
  // Prefix parameters would not appear in the handlers' params type, so they are forbidden to keep types and runtime values in sync
  if (hasDynamicSegment(prefix)) {
    throw new Error(
      `:param and * cannot be used in a namespace path: ${prefix}`,
    )
  }
  const normalized = splitPath(prefix)
    .map((segment) => `/${segment}`)
    .join('')

  // Matches the prefix itself and everything below it, compared like route paths (decoded, segment by segment)
  const scopes = new Map<string, Pattern>()

  return <S extends State = State, E = unknown>(
    ...items: (Route<S, E> | Component<S, E>)[]
  ): Route<S, E> =>
    createRoute(async (ctx, outerPrefix) => {
      const prefix = outerPrefix + normalized
      let inScope: boolean | undefined
      for (const item of items) {
        let result: unknown
        if (isRoute(item)) {
          result = await item[dispatch](ctx, prefix)
        } else {
          inScope ??= isUnder(ctx, prefix)
          if (!inScope) continue
          result = await item(ctx)
        }
        if (result !== undefined) return result
      }
      return undefined
    })

  function isUnder<S extends State, E>(
    ctx: Context<S, E>,
    prefix: string,
  ): boolean {
    let scope = scopes.get(prefix)
    if (!scope) {
      scope = compilePattern(`${prefix}/*`)
      scopes.set(prefix, scope)
    }
    const segments = requestSegments(ctx)
    return segments !== undefined && matchPattern(scope, segments) !== undefined
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
}

/**
 * With `const { get } = createRouter<AppState, Env>()`, handlers get a typed `ctx.state` and `ctx.env`
 * (no need to write `get<'/path', AppState, Env>(...)`). Env defaults to unknown, as in mixer
 */
export function createRouter<S extends State = State, E = unknown>(): Router<
  S,
  E
> {
  return { get, post, put, patch, del, head, options, all, route, namespace }
}
