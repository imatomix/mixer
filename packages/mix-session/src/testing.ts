import type { SessionData, SessionStore } from './store.js'

export interface CheckSessionStoreOptions {
  /**
   * Also check that sessions expire after their ttl. It waits about two seconds of real time, so turn it off
   * for quick runs (defaults to true)
   */
  expiry?: boolean
}

/**
 * Checks that a SessionStore follows the rules mix-session relies on, and throws an Error naming the first rule
 * it breaks. Each check uses fresh random IDs, so a shared store (such as Redis with a prefix) can be used.
 * It is not tied to a test framework: `await checkSessionStore(() => myStore())` inside any test
 */
export async function checkSessionStore(
  create: () => SessionStore | Promise<SessionStore>,
  { expiry = true }: CheckSessionStoreOptions = {},
): Promise<void> {
  const store = await create()
  const sample = (): SessionData => ({
    user: 'mixer',
    count: 1,
    nested: { list: [1, 'two', { three: true }] },
    text: 'ジュース 🍹',
    // An own "__proto__" key, as JSON.parse creates one; a store must keep it as plain data
    ...JSON.parse('{"__proto__":{"polluted":true}}'),
  })

  const missing = newId()
  expect(
    (await store.get(missing)) === undefined,
    'get must return undefined for an unknown ID',
  )

  const id = newId()
  const data = sample()
  await store.set(id, data, 60)
  ;(data.nested as { list: unknown[] }).list.push('changed after set')
  const loaded = await store.get(id)
  expect(
    loaded !== undefined && same(loaded, sample()),
    'get must return what set stored (and set must store a copy)',
  )
  expect(
    ({} as { polluted?: unknown }).polluted === undefined,
    'stored data must not change Object.prototype',
  )

  ;((loaded as { nested: { list: unknown[] } }).nested.list as unknown[]).push(
    'changed after get',
  )
  expect(
    same((await store.get(id)) ?? {}, sample()),
    'get must return a copy, so that changing it does not change the store',
  )

  await store.set(id, { user: 'overwritten' }, 60)
  expect(
    same((await store.get(id)) ?? {}, { user: 'overwritten' }),
    'set must overwrite an existing session',
  )

  expect(
    (await store.update(id, { user: 'updated' }, 60)) === true &&
      same((await store.get(id)) ?? {}, { user: 'updated' }),
    'update must change an existing session and return true',
  )

  const absent = newId()
  expect(
    (await store.update(absent, { user: 'ghost' }, 60)) === false &&
      (await store.get(absent)) === undefined,
    'update must not create a session that does not exist, and must return false',
  )

  await store.delete(id)
  expect((await store.get(id)) === undefined, 'delete must remove the session')
  expect(
    (await store.update(id, { user: 'revived' }, 60)) === false &&
      (await store.get(id)) === undefined,
    'update must not bring back a deleted session (a request holding an old ID after logout)',
  )
  await store.delete(newId())

  if (!expiry) return
  const expiring = newId()
  await store.set(expiring, { v: 1 }, 1)
  const shortened = newId()
  await store.set(shortened, { v: 1 }, 600)
  await store.update(shortened, { v: 2 }, 1)
  await new Promise((resolve) => setTimeout(resolve, 2_100))
  expect(
    (await store.get(expiring)) === undefined,
    'sessions must expire after ttlSeconds',
  )
  expect(
    (await store.get(shortened)) === undefined,
    'update must apply the new ttlSeconds, so sessions expire after it',
  )
}

function expect(condition: boolean, rule: string): void {
  if (!condition) throw new Error(`session store check failed: ${rule}`)
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
