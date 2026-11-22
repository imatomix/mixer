export type RedirectStatus = 301 | 302 | 303 | 307 | 308

export interface RedirectOptions {
  /** Defaults to 302. Use 303 after a form POST */
  status?: RedirectStatus
  /**
   * Origins (such as `https://accounts.example.com`) that absolute URLs may point to. Without it, only paths
   * on this site are accepted
   */
  allowedOrigins?: readonly string[]
  /** Used instead of a missing or unsafe location, such as an untrusted `?next=` value */
  fallback?: string
}

const STATUSES = new Set<number>([301, 302, 303, 307, 308])
const MAX_LENGTH = 8 * 1024
// A base that never matches a real site, so that only paths stay on its origin when resolved against it
const SITE = new URL('http://mixer.invalid')

/**
 * A redirect Response that refuses to send users to another site by mistake (open redirect). By default the
 * location must be a path on this site, such as `/login`; it is not prefixed with basePath
 */
export function redirect(
  location: string | null | undefined,
  options: RedirectOptions = {},
): Response {
  const status = options.status ?? 302
  if (!STATUSES.has(status)) {
    throw new RangeError(
      `redirect status must be 301, 302, 303, 307, or 308: ${status}`,
    )
  }
  const origins = new Set((options.allowedOrigins ?? []).map(toOrigin))
  const fallback =
    options.fallback === undefined
      ? undefined
      : safeLocation(options.fallback, origins)
  if (options.fallback !== undefined && fallback === undefined) {
    throw unsafe(options.fallback)
  }

  const target =
    (location === null || location === undefined
      ? undefined
      : safeLocation(location, origins)) ?? fallback
  if (target === undefined) throw unsafe(location)

  return new Response(null, { status, headers: { Location: target } })
}

/** The value to send in Location, or undefined when the location is not safe */
function safeLocation(
  location: string,
  origins: ReadonlySet<string>,
): string | undefined {
  if (location.length === 0 || location.length > MAX_LENGTH) return undefined
  // Browsers drop whitespace and control characters and read `\` as `/`, so `/\evil.example` would leave the site
  if (location.includes('\\') || hasControl(location, { space: true })) {
    return undefined
  }

  if (location.startsWith('/')) {
    if (location.startsWith('//')) return undefined
    const path = location.split(/[?#]/, 1)[0] ?? ''
    if (!path.split('/').every(isSafeSegment)) return undefined
    const url = new URL(location, SITE)
    // Resolving it again catches anything the checks above missed
    if (url.origin !== SITE.origin) return undefined
    return `${url.pathname}${url.search}${url.hash}`
  }

  let url: URL
  try {
    url = new URL(location)
  } catch {
    return undefined
  }
  if (url.username || url.password || !origins.has(url.origin)) {
    return undefined
  }
  return url.href
}

/**
 * Rejects malformed percent-encoding, encoded separators or control characters (another layer that decodes the
 * path again could turn `/%2F%2Fevil.example` into `//evil.example`), and `.` or `..` segments
 */
function isSafeSegment(segment: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return false
  }
  if (/[/\\]/.test(decoded) || hasControl(decoded, { space: false })) {
    return false
  }
  return decoded !== '.' && decoded !== '..'
}

function hasControl(value: string, { space }: { space: boolean }): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f || (space && code === 0x20)) return true
  }
  return false
}

function toOrigin(entry: string): string {
  let url: URL | undefined
  try {
    url = new URL(entry)
  } catch {}
  const plain =
    url !== undefined &&
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !entry.includes('*') &&
    entry.replace(/\/$/, '') === url.origin
  if (!plain || url === undefined) {
    throw new TypeError(
      `redirect allowedOrigins takes origins such as https://example.com: ${JSON.stringify(entry)}`,
    )
  }
  return url.origin
}

function unsafe(location: string | null | undefined): TypeError {
  // JSON.stringify escapes line breaks, so a rejected value cannot add lines to a log
  const shown = JSON.stringify(String(location).slice(0, 100))
  return new TypeError(
    `unsafe redirect location: ${shown}. Pass a path on this site such as '/login', list external origins in allowedOrigins, or give a fallback`,
  )
}
