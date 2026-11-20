import type { Context, State } from '@imatomix/mixer'
import type { Params } from './params.js'
import {
  compilePattern,
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

/** mixer の Component としてそのまま `mix()` でき、namespace にも入れられるルート */
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
  // namespace の prefix ごとにパターンを作り直さないようキャッシュする
  const patterns = new Map<string, Pattern>()
  compilePattern(path)

  return createRoute(async (ctx, prefix) => {
    if (!acceptsMethod(ctx.method)) return undefined

    let pattern = patterns.get(prefix)
    if (!pattern) {
      pattern = compilePattern(prefix + path)
      patterns.set(prefix, pattern)
    }
    const params = matchPattern(pattern, splitPath(ctx.url.pathname))
    if (!params) return undefined

    for (const handler of handlers) {
      const result = await handler(ctx, params as Params<Path>)
      if (ctx.sent) return undefined
      if (result !== undefined) return result
    }
    return undefined
  })
}

type MethodRoute = <Path extends string, S extends State = State>(
  path: Path,
  ...handlers: RouteHandler<Params<Path>, S>[]
) => Route<S>

function methodRoute(method: string): MethodRoute {
  return (path, ...handlers) => route(method, path, ...handlers)
}

/** HEAD にも応答する */
export const get = methodRoute('GET')
export const post = methodRoute('POST')
export const put = methodRoute('PUT')
export const patch = methodRoute('PATCH')
/** `delete` は予約語なので `del` */
export const del = methodRoute('DELETE')
export const head = methodRoute('HEAD')
export const options = methodRoute('OPTIONS')

export function namespace(prefix: string) {
  // prefix のパラメータは各ハンドラの params の型に現れないため、型と実行時の値がずれないよう禁止する
  if (hasDynamicSegment(prefix)) {
    throw new Error(`namespace のパスに :param や * は使えません: ${prefix}`)
  }
  const normalized = splitPath(prefix)
    .map((segment) => `/${segment}`)
    .join('')

  return <S extends State = State>(...routes: Route<S>[]): Route<S> =>
    createRoute(async (ctx, outerPrefix) => {
      for (const child of routes) {
        const result = await child[dispatch](ctx, outerPrefix + normalized)
        if (ctx.sent) return undefined
        if (result !== undefined) return result
      }
      return undefined
    })
}
