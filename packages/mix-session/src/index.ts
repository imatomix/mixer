import type { Component, Context, CookieOptions } from '@imatomix/mixer'
import { Session, snapshot } from './session.js'
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
  /**
   * Seconds after which a session ends, however active it is (defaults to 604800, 7 days). It restarts when a
   * session is created or regenerated (such as on login). `false` turns it off
   */
  absoluteTtl?: number | false
  /** Cookie attributes. Defaults to the same as mixer's ctx.cookies (HttpOnly, Secure, SameSite=Lax) */
  cookie?: Omit<CookieOptions, 'maxAge' | 'expires'>
  /**
   * Cache-Control for every response to a request with a session (one was loaded, or the response sets or clears
   * its cookie), replacing any other value: such responses show one user's data, and an accidental `public` would
   * hand it to others. Defaults to `private, no-store`. Another policy must include unqualified `private` or `no-store` and not
   * `public`; false leaves caching to the app
   */
  cacheControl?: string | false
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
  const absoluteTtl = options.absoluteTtl ?? 604_800
  checkCookiePrefix(name, cookie)
  const cacheControl = checkCacheControl(
    options.cacheControl ?? 'private, no-store',
  )
  if (!Number.isInteger(ttl) || ttl < 1) {
    throw new Error(`mix-session: ttl must be an integer of 1 or more: ${ttl}`)
  }
  if (
    absoluteTtl !== false &&
    (!Number.isInteger(absoluteTtl) || absoluteTtl < 1)
  ) {
    throw new Error(
      `mix-session: absoluteTtl must be an integer of 1 or more, or false: ${absoluteTtl}`,
    )
  }

  /** Seconds this session may still live: the shorter of ttl and the time left before absoluteTtl */
  const lifetime = (createdAt: number, now = Date.now()): number => {
    if (absoluteTtl === false) return ttl
    const left = Math.floor((createdAt + absoluteTtl * 1000 - now) / 1000)
    return Math.min(ttl, left)
  }

  return async (ctx, next) => {
    const loadedId = readSessionId(ctx, name)
    const record = loadedId ? toRecord(await store.get(loadedId)) : undefined
    // An expired session is treated as missing, and removed when the response is sent
    const live = record && lifetime(record.createdAt) >= 1 ? record : undefined
    const expiredId = record && !live ? loadedId : undefined
    // Never adopt an ID that is not in the store. Otherwise an attacker could make a victim use an ID the attacker chose
    const session = new Session<D>(
      (live?.data ?? {}) as Partial<D>,
      live ? loadedId : undefined,
    )
    ;(ctx.state as SessionState<D>).session = session

    await next()
    // Saved after everything else ran, on whatever response it produced, errors included
    await save(ctx, session, live?.createdAt ?? Date.now(), expiredId)
    if (cacheControl !== false) {
      const setsCookie = ctx.headers
        .getSetCookie()
        .some((line) => line.startsWith(`${name}=`))
      if (live || setsCookie) ctx.headers.set('Cache-Control', cacheControl)
    }
  }

  async function save(
    ctx: Context,
    session: Session<D>,
    createdAt: number,
    expiredId: string | undefined,
  ): Promise<void> {
    const { data, change } = snapshot(session)
    const currentId = session.id
    const created =
      change === 'regenerated' || (change === 'modified' && !currentId)

    if (expiredId) {
      await store.delete(expiredId)
      if (!created) ctx.cookies.delete(name, cookie)
    }

    if (change === 'destroyed' || (change !== 'none' && isEmpty(data))) {
      if (currentId) {
        await store.delete(currentId)
        ctx.cookies.delete(name, cookie)
      }
      return
    }

    if (created) {
      if (currentId) await store.delete(currentId)
      // A new or regenerated session (such as on login) starts its absolute lifetime now
      const now = Date.now()
      const newId = generateId()
      // The same clock reading for both, so that the new session gets its full lifetime
      const seconds = lifetime(now, now)
      await store.set(newId, { createdAt: now, data }, seconds)
      issueCookie(ctx, newId, seconds)
      return
    }

    if (currentId && (change === 'modified' || rolling)) {
      const seconds = lifetime(createdAt)
      // The absolute lifetime ran out during this request
      if (seconds < 1) {
        await store.delete(currentId)
        ctx.cookies.delete(name, cookie)
        return
      }
      // Do not save if the session was destroyed or regenerated concurrently (never bring an old ID back)
      const updated = await store.update(
        currentId,
        { createdAt, data },
        seconds,
      )
      if (updated) issueCookie(ctx, currentId, seconds)
    }
  }

  function issueCookie(ctx: Context, id: string, seconds: number): void {
    ctx.cookies.set(name, id, { ...cookie, maxAge: seconds })
  }
}

/** What mix-session keeps in the store: the data, and when the session was created for absoluteTtl */
interface SessionRecord {
  createdAt: number
  data: SessionData
}

/** A stored value in any other shape (for example, written by something else) is not adopted */
function toRecord(value: SessionData | undefined): SessionRecord | undefined {
  if (value === undefined) return undefined
  const { createdAt, data } = value
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
    return undefined
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return undefined
  }
  return { createdAt, data: data as SessionData }
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

/** Only unqualified private/no-store protects the whole response; quoted commas are not separators. */
function checkCacheControl(value: string | false): string | false {
  if (value === false) return false
  const directive =
    / *([!#$%&'*+.^_`|~0-9a-z-]+)(?:=(?:[!#$%&'*+.^_`|~0-9a-z-]+|"(?:[^"\\]|\\.)*"))? *(?:,|$)/giy
  let protectedResponse = false
  let valid = /^[ -~]+$/.test(value)
  let offset = 0
  while (valid && offset < value.length) {
    const match = directive.exec(value)
    if (!match) {
      valid = false
      break
    }
    offset = directive.lastIndex
    const name = match[1]?.toLowerCase()
    const hasArgument = match[0].includes('=')
    if (name === 'public') valid = false
    if (!hasArgument && (name === 'private' || name === 'no-store')) {
      protectedResponse = true
    }
  }
  if (valid && protectedResponse) return value
  throw new TypeError(
    `mix-session: cacheControl must include unqualified private or no-store and not public, or be false: ${JSON.stringify(value)}`,
  )
}
