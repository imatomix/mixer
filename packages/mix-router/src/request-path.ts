import type { Context, State } from '@imatomix/mixer'
import { decodePath } from './pattern.js'

type Decoded = { segments: string[] | undefined } | { error: unknown }

// Every route needs the decoded path, so decode it once per request and share the result
// (including a 400 for malformed encoding) between routes
const decodedPaths = new WeakMap<Context<State>, Decoded>()

export function requestSegments<S extends State, E>(
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
