import type { Context, State } from '@imatomix/mixer'
import {
  compilePattern,
  hasDynamicSegment,
  matchPattern,
  type Pattern,
  splitPath,
} from './pattern.js'
import { requestSegments } from './request-path.js'

/**
 * Matches a prefix and everything below it, compared like route paths (decoded, segment by segment), under the
 * prefixes of enclosing groups
 */
export function prefixScope(kind: 'group' | 'mount', prefix: string) {
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
