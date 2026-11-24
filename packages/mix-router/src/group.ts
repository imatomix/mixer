import { type Component, compose, type State } from '@imatomix/mixer'
import { prefixScope } from './prefix.js'
import { createRoute, dispatch, isRoute, type Route } from './route.js'

/** What a group takes: routes and components, or arrays of them, such as the routes exported from one file */
export type GroupItem<S extends State = State, E = unknown> =
  | Route<S, E>
  | Component<S, E>
  | readonly (Route<S, E> | Component<S, E>)[]

/**
 * Puts routes and components under a prefix, like a router mounted at a path elsewhere:
 * `group('/todos', todoRoutes)`. The items run in order as one group, so next() inside wraps the rest of the
 * group and what follows it, and a component first in the group guards every path under the prefix
 */
export function group<S extends State = State, E = unknown>(
  prefix: string,
  ...items: readonly GroupItem<S, E>[]
): Route<S, E> {
  const scope = prefixScope('group', prefix)
  const flat = items.flat()

  return createRoute(async (ctx, outerPrefix, next) => {
    const full = scope.under(ctx, outerPrefix)
    // Nothing inside can match a path outside the prefix
    if (full === undefined) return undefined
    const members = flat.map(
      (item): Component<S, E> =>
        isRoute(item)
          ? (inner, innerNext) => item[dispatch](inner, full, innerNext)
          : item,
    )
    return compose(...members)(ctx, next)
  })
}
