import { randomBytes } from 'node:crypto'
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
  /** 既定は新しい MemoryStore */
  store?: SessionStore
  /** Cookie の名前（既定 `sid`） */
  name?: string
  /** セッションの有効期間（秒、既定 86400）。Cookie の Max-Age とストアの期限に使う */
  ttl?: number
  /** 読むだけのリクエストでも期限を延ばす */
  rolling?: boolean
  /** Cookie の属性。既定は mixer の ctx.cookies と同じ（HttpOnly・Secure・SameSite=Lax） */
  cookie?: Omit<CookieOptions, 'maxAge' | 'expires'>
}

/** `ctx.state` に入る値の型。`Mixer<SessionState>` のように使う */
export type SessionState<D extends SessionData = SessionData> = {
  session: Session<D>
}

// 32 バイトの乱数を base64url にしたもの（43 文字）
const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function session<D extends SessionData = SessionData>(
  options: SessionOptions = {},
): Component {
  const store = options.store ?? new MemoryStore()
  const name = options.name ?? 'sid'
  const ttl = options.ttl ?? 86_400
  const rolling = options.rolling ?? false
  const cookie = options.cookie ?? {}
  if (!Number.isInteger(ttl) || ttl < 1) {
    throw new Error(
      `mix-session: ttl は 1 以上の整数で指定してください: ${ttl}`,
    )
  }

  return async (ctx) => {
    const loadedId = readSessionId(ctx, name)
    const data = loadedId ? await store.get(loadedId) : undefined
    // ストアにない ID は採用しない。そのまま使うと、攻撃者が決めた ID で被害者のセッションを作らせられる
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
      // 並行して破棄・再生成されていたら保存しない（古い ID を復活させない）
      const updated = await store.update(currentId, data as SessionData, ttl)
      if (updated) issueCookie(ctx, currentId)
    }
  }

  function issueCookie(ctx: Context, id: string): void {
    ctx.cookies.set(name, id, { ...cookie, maxAge: ttl })
    // Set-Cookie 付きの応答が共有キャッシュに保存されると、他の利用者に同じセッションが配られる
    ctx.res.setHeader('Cache-Control', 'private, no-store')
  }
}

function readSessionId(ctx: Context, name: string): string | undefined {
  const values = ctx.cookies.getAll(name)
  // 同じ名前が複数あるのは、サブドメインなどから Cookie を仕込まれた可能性があるので信用しない
  if (values.length !== 1) return undefined
  const [id] = values
  return id !== undefined && ID_PATTERN.test(id) ? id : undefined
}

function generateId(): string {
  return randomBytes(32).toString('base64url')
}

function isEmpty(data: object): boolean {
  return Object.keys(data).length === 0
}
