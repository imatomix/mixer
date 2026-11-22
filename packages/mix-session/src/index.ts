import type { Component, Context, CookieOptions } from '@imatomix/mixer'
import { Session } from './session.js'
import { MemoryStore, type SessionData, type SessionStore } from './store.js'

export { Session } from './session.js'
export {
  MemoryStore,
  type MemoryStoreOptions,
  type SessionData,
  type SessionStore,
} from './store.js'

export interface SessionOptions {
  /** Defaults to a new MemoryStore */
  store?: SessionStore
  /**
   * Cookie name. Defaults to `__Host-sid`, or `__Secure-sid` with `cookie.domain`, or `sid` with `cookie.secure: false`
   */
  name?: string
  /** Session lifetime in seconds (defaults to 86400). Used for the cookie's Max-Age and the store's expiry */
  ttl?: number
  /** Extend the expiry even on requests that only read the session */
  rolling?: boolean
  /** Cookie attributes. Defaults to the same as mixer's ctx.cookies (HttpOnly, Secure, SameSite=Lax) */
  cookie?: Omit<CookieOptions, 'maxAge' | 'expires'>
}

/** Type of the value added to `ctx.state`. Use it as `Mixer<SessionState>` */
export type SessionState<D extends SessionData = SessionData> = {
  session: Session<D>
}

// 32 random bytes in base64url (43 characters)
const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function session<D extends SessionData = SessionData>(
  options: SessionOptions = {},
): Component {
  const store = options.store ?? new MemoryStore()
  const cookie = options.cookie ?? {}
  const name = options.name ?? defaultCookieName(cookie)
  const ttl = options.ttl ?? 86_400
  const rolling = options.rolling ?? false
  checkCookiePrefix(name, cookie)
  if (!Number.isInteger(ttl) || ttl < 1) {
    throw new Error(`mix-session: ttl must be an integer of 1 or more: ${ttl}`)
  }

  return async (ctx) => {
    const loadedId = readSessionId(ctx, name)
    const data = loadedId ? await store.get(loadedId) : undefined
    // Never adopt an ID that is not in the store. Otherwise an attacker could make a victim use an ID the attacker chose
    const session = new Session<D>(
      (data ?? {}) as Partial<D>,
      data ? loadedId : undefined,
    )
    ;(ctx.state as SessionState<D>).session = session

    ctx.onBeforeSend(() => save(ctx, session))
    return undefined
  }

  async function save(ctx: Context, session: Session<D>): Promise<void> {
    const { data, change } = session.snapshot()
    const currentId = session.id

    if (change === 'destroyed' || (change !== 'none' && isEmpty(data))) {
      if (currentId) {
        await store.delete(currentId)
        ctx.cookies.delete(name, cookie)
      }
      return
    }

    if (change === 'regenerated' || (change === 'modified' && !currentId)) {
      if (currentId) await store.delete(currentId)
      const newId = generateId()
      await store.set(newId, data as SessionData, ttl)
      issueCookie(ctx, newId)
      return
    }

    if (currentId && (change === 'modified' || rolling)) {
      // Do not save if the session was destroyed or regenerated concurrently (never bring an old ID back)
      const updated = await store.update(currentId, data as SessionData, ttl)
      if (updated) issueCookie(ctx, currentId)
    }
  }

  function issueCookie(ctx: Context, id: string): void {
    ctx.cookies.set(name, id, { ...cookie, maxAge: ttl })
    // If a response with Set-Cookie were stored in a shared cache, other users would receive the same session
    ctx.headers.set('Cache-Control', 'private, no-store')
  }
}

function readSessionId(ctx: Context, name: string): string | undefined {
  const values = ctx.cookies.getAll(name)
  // More than one cookie with the same name may mean one was planted from a subdomain, so trust none of them
  if (values.length !== 1) return undefined
  const [id] = values
  return id !== undefined && ID_PATTERN.test(id) ? id : undefined
}

/**
 * The strongest cookie prefix the options allow. A `__Host-` cookie cannot be set from another subdomain or an
 * http page, so an attacker cannot plant a session ID that way; `__Host-` forbids Domain and needs Path=/, so a shared domain or a narrower path gets
 * `__Secure-`, which still keeps http pages out. Both need Secure, so `secure: false` gets a plain name
 */
function defaultCookieName(cookie: SessionOptions['cookie'] & {}): string {
  if (cookie.secure === false) return 'sid'
  const hostOnly = cookie.domain === undefined && (cookie.path ?? '/') === '/'
  return hostOnly ? '__Host-sid' : '__Secure-sid'
}

/** Fails at definition instead of on the first login, for prefixes that browsers would reject */
function checkCookiePrefix(
  name: string,
  cookie: SessionOptions['cookie'] & {},
): void {
  const secure = cookie.secure !== false
  const hostOnly = cookie.domain === undefined && (cookie.path ?? '/') === '/'
  if (name.startsWith('__Host-') && (!secure || !hostOnly)) {
    throw new Error(
      `mix-session: a ${name} cookie needs Secure, no domain, and path '/'; change those options or choose another name`,
    )
  }
  if (name.startsWith('__Secure-') && !secure) {
    throw new Error(
      `mix-session: a ${name} cookie needs Secure; remove cookie.secure: false or choose another name`,
    )
  }
}

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function isEmpty(data: object): boolean {
  return Object.keys(data).length === 0
}
