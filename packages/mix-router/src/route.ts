import type { Component, Context, Next, State } from '@imatomix/mixer'
import { methodRecord } from './method-not-allowed.js'
import type { Params } from './params.js'
import { compilePattern, matchPattern, type Pattern } from './pattern.js'
import { requestSegments } from './request-path.js'

export type RouteHandler<
  P = Record<string, string>,
  S extends State = State,
  E = unknown,
> = (ctx: Context<S, E>, params: P) => unknown

export const dispatch = Symbol('dispatch')

export type Dispatch<S extends State, E> = (
  ctx: Context<S, E>,
  prefix: string,
  next: Next,
) => Promise<unknown>

/** A route that can be passed to `mix()` as a mixer Component and nested in a group */
export interface Route<S extends State = State, E = unknown> {
  (ctx: Context<S, E>, next: Next): Promise<unknown>
  readonly [dispatch]: Dispatch<S, E>
}

export function createRoute<S extends State, E>(
  run: Dispatch<S, E>,
): Route<S, E> {
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
  // Cache the compiled pattern per group prefix instead of compiling it on every request
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

export function isRoute<S extends State, E>(
  item: Route<S, E> | Component<S, E>,
): item is Route<S, E> {
  return dispatch in item
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
