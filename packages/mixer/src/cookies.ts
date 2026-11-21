export interface CookieOptions {
  /** In seconds. Zero or less expires the cookie immediately */
  maxAge?: number
  expires?: Date
  /** Defaults to `/` */
  path?: string
  domain?: string
  /** Defaults to true. Hides the cookie from JavaScript */
  httpOnly?: boolean
  /** Defaults to true. Set to false when developing on http://localhost */
  secure?: boolean
  /** Defaults to `Lax` */
  sameSite?: 'Strict' | 'Lax' | 'None'
  partitioned?: boolean
  priority?: 'Low' | 'Medium' | 'High'
}

export type CookieDeleteOptions = Pick<
  CookieOptions,
  'path' | 'domain' | 'httpOnly' | 'secure' | 'sameSite' | 'partitioned'
>

// cookie-name from RFC 6265 (token from RFC 7230)
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
// `;` and control characters would allow injecting attributes or headers, so allow printable ASCII except `;`
const COOKIE_PATH = /^\/[\x20-\x3a\x3c-\x7e]*$/
const COOKIE_DOMAIN = /^\.?[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/
const SAME_SITE = new Set(['Strict', 'Lax', 'None'])
const PRIORITY = new Set(['Low', 'Medium', 'High'])
const EPOCH = new Date(0)

export class Cookies {
  readonly #requestHeaders: Headers
  readonly #draft: Headers
  readonly #isLocked: () => boolean
  #parsed: Map<string, string[]> | undefined
  /** Remembers the cookies set here so that setting the same name, Path, and Domain again replaces them */
  readonly #pending = new Map<string, string>()
  #written = new Set<string>()

  constructor(
    requestHeaders: Headers,
    draft: Headers,
    isLocked: () => boolean,
  ) {
    this.#requestHeaders = requestHeaders
    this.#draft = draft
    this.#isLocked = isLocked
  }

  /** The first value when the name appears more than once (browsers send the most specific Path first) */
  get(name: string): string | undefined {
    return this.getAll(name)[0]
  }

  getAll(name: string): string[] {
    this.#parsed ??= parseCookieHeader(
      this.#requestHeaders.get('cookie') ?? undefined,
    )
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
    if (this.#isLocked()) {
      throw new Error(`Cannot set cookies after the response is final: ${name}`)
    }
    this.#pending.set(
      `${name}\n${options.path}\n${options.domain ?? ''}`,
      header,
    )
    const others = this.#draft
      .getSetCookie()
      .filter((existing) => !this.#written.has(existing))
    const ours = [...this.#pending.values()]
    this.#written = new Set(ours)
    this.#draft.delete('Set-Cookie')
    for (const cookie of [...others, ...ours]) {
      this.#draft.append('Set-Cookie', cookie)
    }
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
    throw new TypeError(`Invalid options for cookie "${name}": ${reason}`)
  }
  if (!COOKIE_NAME.test(name))
    fail('the name contains characters that are not allowed')
  if (!COOKIE_PATH.test(options.path)) fail(`path: ${options.path}`)
  if (options.domain !== undefined && !COOKIE_DOMAIN.test(options.domain)) {
    fail(`domain: ${options.domain}`)
  }
  if (options.maxAge !== undefined && !Number.isInteger(options.maxAge)) {
    fail(`maxAge must be an integer: ${options.maxAge}`)
  }
  if (
    options.expires !== undefined &&
    Number.isNaN(options.expires.getTime())
  ) {
    fail('expires is an invalid date')
  }
  if (!SAME_SITE.has(options.sameSite)) fail(`sameSite: ${options.sameSite}`)
  if (options.priority !== undefined && !PRIORITY.has(options.priority)) {
    fail(`priority: ${options.priority}`)
  }
  // Fail loudly on combinations that browsers would silently reject
  if (options.sameSite === 'None' && !options.secure) {
    fail('SameSite=None requires Secure')
  }
  if (options.partitioned && !options.secure) {
    fail('Partitioned requires Secure')
  }
  if (name.startsWith('__Secure-') && !options.secure) {
    fail('names starting with __Secure- require Secure')
  }
  if (name.startsWith('__Host-')) {
    if (
      !options.secure ||
      options.path !== '/' ||
      options.domain !== undefined
    ) {
      fail('names starting with __Host- require Secure, Path=/, and no Domain')
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
