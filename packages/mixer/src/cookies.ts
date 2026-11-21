import type { IncomingMessage, ServerResponse } from 'node:http'

export interface CookieOptions {
  /** 秒数。0 以下ですぐに失効する */
  maxAge?: number
  expires?: Date
  /** 既定 `/` */
  path?: string
  domain?: string
  /** 既定 true。JavaScript から読ませない */
  httpOnly?: boolean
  /** 既定 true。http の localhost で開発するときは false を指定する */
  secure?: boolean
  /** 既定 `Lax` */
  sameSite?: 'Strict' | 'Lax' | 'None'
  partitioned?: boolean
  priority?: 'Low' | 'Medium' | 'High'
}

export type CookieDeleteOptions = Pick<
  CookieOptions,
  'path' | 'domain' | 'httpOnly' | 'secure' | 'sameSite' | 'partitioned'
>

// RFC 6265 の cookie-name（RFC 7230 の token）
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
// ; や制御文字が入ると属性やヘッダを差し込まれるので、; 以外の印字可能な ASCII に限る
const COOKIE_PATH = /^\/[\x20-\x3a\x3c-\x7e]*$/
const COOKIE_DOMAIN = /^\.?[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/
const SAME_SITE = new Set(['Strict', 'Lax', 'None'])
const PRIORITY = new Set(['Low', 'Medium', 'High'])
const EPOCH = new Date(0)

export class Cookies {
  readonly #req: IncomingMessage
  readonly #res: ServerResponse
  #parsed: Map<string, string[]> | undefined
  /** 同じ名前・Path・Domain の Cookie を設定し直したときに置き換えるため、自分が出したものを覚えておく */
  readonly #pending = new Map<string, string>()
  #written = new Set<string>()

  constructor(req: IncomingMessage, res: ServerResponse) {
    this.#req = req
    this.#res = res
  }

  /** 同じ名前が複数あるときは最初の値（ブラウザはより具体的な Path のものを先に送る） */
  get(name: string): string | undefined {
    return this.getAll(name)[0]
  }

  getAll(name: string): string[] {
    this.#parsed ??= parseCookieHeader(this.#req.headers.cookie)
    return [...(this.#parsed.get(name) ?? [])]
  }

  set(name: string, value: string, options: CookieOptions = {}): void {
    const resolved = withDefaults(options)
    validate(name, resolved)
    this.#queue(
      name,
      resolved,
      serialize(name, encodeURIComponent(value), resolved),
    )
  }

  delete(name: string, options: CookieDeleteOptions = {}): void {
    const resolved = withDefaults({ ...options, maxAge: 0, expires: EPOCH })
    validate(name, resolved)
    this.#queue(name, resolved, serialize(name, '', resolved))
  }

  #queue(name: string, options: ResolvedOptions, header: string): void {
    if (this.#res.headersSent) {
      throw new Error(`応答を送った後は Cookie を設定できません: ${name}`)
    }
    this.#pending.set(
      `${name}\n${options.path}\n${options.domain ?? ''}`,
      header,
    )
    const others = toArray(this.#res.getHeader('Set-Cookie')).filter(
      (existing) => !this.#written.has(existing),
    )
    const ours = [...this.#pending.values()]
    this.#written = new Set(ours)
    this.#res.setHeader('Set-Cookie', [...others, ...ours])
  }
}

type ResolvedOptions = CookieOptions & {
  path: string
  httpOnly: boolean
  secure: boolean
  sameSite: NonNullable<CookieOptions['sameSite']>
}

function withDefaults(options: CookieOptions): ResolvedOptions {
  return {
    ...options,
    path: options.path ?? '/',
    httpOnly: options.httpOnly ?? true,
    secure: options.secure ?? true,
    sameSite: options.sameSite ?? 'Lax',
  }
}

function validate(name: string, options: ResolvedOptions): void {
  const fail = (reason: string) => {
    throw new TypeError(`Cookie "${name}" の設定が不正です: ${reason}`)
  }
  if (!COOKIE_NAME.test(name)) fail('名前に使えない文字が含まれています')
  if (!COOKIE_PATH.test(options.path)) fail(`path: ${options.path}`)
  if (options.domain !== undefined && !COOKIE_DOMAIN.test(options.domain)) {
    fail(`domain: ${options.domain}`)
  }
  if (options.maxAge !== undefined && !Number.isInteger(options.maxAge)) {
    fail(`maxAge は整数で指定してください: ${options.maxAge}`)
  }
  if (
    options.expires !== undefined &&
    Number.isNaN(options.expires.getTime())
  ) {
    fail('expires が不正な日付です')
  }
  if (!SAME_SITE.has(options.sameSite)) fail(`sameSite: ${options.sameSite}`)
  if (options.priority !== undefined && !PRIORITY.has(options.priority)) {
    fail(`priority: ${options.priority}`)
  }
  // ブラウザが拒否する組み合わせは、黙って無視される前に気づけるようにする
  if (options.sameSite === 'None' && !options.secure) {
    fail('SameSite=None には Secure が必要です')
  }
  if (options.partitioned && !options.secure) {
    fail('Partitioned には Secure が必要です')
  }
  if (name.startsWith('__Secure-') && !options.secure) {
    fail('__Secure- で始まる名前には Secure が必要です')
  }
  if (name.startsWith('__Host-')) {
    if (
      !options.secure ||
      options.path !== '/' ||
      options.domain !== undefined
    ) {
      fail('__Host- で始まる名前には Secure・Path=/・Domain なしが必要です')
    }
  }
}

function serialize(
  name: string,
  encodedValue: string,
  options: ResolvedOptions,
): string {
  const parts = [`${name}=${encodedValue}`]
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
  parts.push(`Path=${options.path}`)
  if (options.domain) parts.push(`Domain=${options.domain}`)
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  parts.push(`SameSite=${options.sameSite}`)
  if (options.partitioned) parts.push('Partitioned')
  if (options.priority) parts.push(`Priority=${options.priority}`)
  return parts.join('; ')
}

function parseCookieHeader(header: string | undefined): Map<string, string[]> {
  const cookies = new Map<string, string[]>()
  if (!header) return cookies
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    const name = pair.slice(0, index).trim()
    if (!name) continue
    let value = pair.slice(index + 1).trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    const values = cookies.get(name) ?? []
    values.push(decodeOrRaw(value))
    cookies.set(name, values)
  }
  return cookies
}

function decodeOrRaw(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function toArray(header: ReturnType<ServerResponse['getHeader']>): string[] {
  if (header === undefined) return []
  return Array.isArray(header) ? header : [String(header)]
}
