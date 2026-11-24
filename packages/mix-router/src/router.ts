import type { Mixer, State } from '@imatomix/mixer'
import { type GroupItem, group } from './group.js'
import { type FetchHandler, mount } from './mount.js'
import type { Params } from './params.js'
import {
  all,
  del,
  get,
  head,
  options,
  patch,
  post,
  put,
  type Route,
  type RouteHandler,
  route,
} from './route.js'

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
  group: (prefix: string, ...items: readonly GroupItem<S, E>[]) => Route<S, E>
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
    group,
    mount,
  }
}
