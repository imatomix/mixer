import { type Component, type Context, HttpError } from '@imatomix/mixer'

export interface CsrfOptions {
  /**
   * Other origins allowed to send requests, such as `https://admin.example`. Written exactly as browsers send
   * the Origin header: scheme, lowercase host, and port only when it is not the default
   */
  trustedOrigins?: readonly string[]
  /** Requests for which this returns true are not checked, such as webhooks from other services */
  allow?: (ctx: Context) => boolean | Promise<boolean>
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SAME_ORIGIN_SITES = new Set(['same-origin', 'none'])

/**
 * Rejects requests that change state (anything but GET, HEAD, and OPTIONS) when a browser sent them from another
 * site, using the Sec-Fetch-Site and Origin headers browsers add. No tokens are needed. Requests without either
 * header come from clients other than browsers, which cannot carry a user's cookies to the app, so they pass
 */
export function csrf(options: CsrfOptions = {}): Component {
  const trustedOrigins = new Set(
    (options.trustedOrigins ?? []).map(checkOrigin),
  )
  const allow = options.allow

  return async (ctx) => {
    if (SAFE_METHODS.has(ctx.method)) return undefined
    const site = ctx.request.headers.get('sec-fetch-site')
    const origin = ctx.request.headers.get('origin')

    if (site !== null ? SAME_ORIGIN_SITES.has(site) : origin === null) {
      return undefined
    }
    // Browsers without Sec-Fetch-Site (before 2023) only send Origin, which is compared with the host the browser
    // addressed. The scheme is not compared, so http://host is accepted for https://host as well
    if (site === null && origin !== null && hostOf(origin) === ctx.url.host) {
      return undefined
    }
    if (origin !== null && trustedOrigins.has(origin)) return undefined
    if (allow && (await allow(ctx))) return undefined
    throw new HttpError(403, 'Cross-origin request blocked')
  }
}

function checkOrigin(origin: string): string {
  // URL accepts `*` in a host name, but it is not a wildcard here and would never match
  if (
    !origin.includes('*') &&
    URL.canParse(origin) &&
    new URL(origin).origin === origin
  ) {
    return origin
  }
  throw new TypeError(
    `mix-csrf: trustedOrigins takes origins such as https://example.com, without a path or a trailing slash: ${JSON.stringify(origin)}`,
  )
}

function hostOf(origin: string): string | undefined {
  return URL.canParse(origin) ? new URL(origin).host : undefined
}
