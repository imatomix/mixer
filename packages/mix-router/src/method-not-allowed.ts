import {
  type Component,
  type Context,
  HttpError,
  type State,
} from '@imatomix/mixer'

/** What the routes whose path matched found out about the method, for methodNotAllowed */
interface MethodRecord {
  allowed: Set<string>
  /** A route that takes this method (or any method) matched, so the answer is not 405 */
  taken: boolean
}

const methodRecords = new WeakMap<Context<State>, MethodRecord>()

export function methodRecord<S extends State, E>(
  ctx: Context<S, E>,
): MethodRecord {
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
