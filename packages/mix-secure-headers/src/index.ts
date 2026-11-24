import type { Component } from '@imatomix/mixer'

const REFERRER_POLICIES = [
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
] as const
const FRAME_OPTIONS = ['DENY', 'SAMEORIGIN'] as const
const OPENER_POLICIES = [
  'same-origin',
  'same-origin-allow-popups',
  'noopener-allow-popups',
  'unsafe-none',
] as const
const RESOURCE_POLICIES = ['same-origin', 'same-site', 'cross-origin'] as const

export type ReferrerPolicy = (typeof REFERRER_POLICIES)[number]

export interface HstsOptions {
  /** Seconds browsers keep using HTTPS only */
  maxAge: number
  includeSubDomains?: boolean
  /** Requires includeSubDomains and a maxAge of at least one year, as the preload list does */
  preload?: boolean
}

/** CSP directives, such as `{ 'default-src': ["'self'"], 'upgrade-insecure-requests': [] }` */
export type CspDirectives = Readonly<Record<string, readonly string[]>>

export interface SecureHeadersOptions {
  /** `X-Frame-Options`, which stops other sites from showing pages in a frame. Default `'DENY'` */
  frameOptions?: (typeof FRAME_OPTIONS)[number] | false
  /** `Referrer-Policy`. Default `'strict-origin-when-cross-origin'` */
  referrerPolicy?: ReferrerPolicy | false
  /**
   * `Strict-Transport-Security`. Off by default: browsers keep it for maxAge and it cannot be taken back over HTTP,
   * and it must only be sent over HTTPS. `true` is one year without subdomains
   */
  hsts?: boolean | HstsOptions
  /** `Content-Security-Policy`, as directives or a whole header value. Off by default */
  csp?: CspDirectives | string | false
  /** `Cross-Origin-Opener-Policy`. Off by default because `same-origin` breaks sign-in and payment popups */
  crossOriginOpenerPolicy?: (typeof OPENER_POLICIES)[number] | false
  /** `Cross-Origin-Resource-Policy`. Off by default because it stops other sites from loading your images and files */
  crossOriginResourcePolicy?: (typeof RESOURCE_POLICIES)[number] | false
  /** `Permissions-Policy` as a whole header value, such as `'camera=(), geolocation=(self)'`. Off by default */
  permissionsPolicy?: string | false
}

const ONE_YEAR = 31536000

/**
 * Adds security headers to every response, including 404 and error responses. A header that a later component
 * set, or that a returned Response has, is kept, so routes can change any of them
 */
export function secureHeaders(options: SecureHeadersOptions = {}): Component {
  const headers: [string, string][] = []
  const add = (name: string, value: string | undefined) => {
    if (value !== undefined) headers.push([name, value])
  }

  add(
    'X-Frame-Options',
    oneOf('frameOptions', options.frameOptions ?? 'DENY', FRAME_OPTIONS),
  )
  add(
    'Referrer-Policy',
    oneOf(
      'referrerPolicy',
      options.referrerPolicy ?? 'strict-origin-when-cross-origin',
      REFERRER_POLICIES,
    ),
  )
  add('Strict-Transport-Security', hsts(options.hsts ?? false))
  add('Content-Security-Policy', csp(options.csp ?? false))
  add(
    'Cross-Origin-Opener-Policy',
    oneOf(
      'crossOriginOpenerPolicy',
      options.crossOriginOpenerPolicy ?? false,
      OPENER_POLICIES,
    ),
  )
  add(
    'Cross-Origin-Resource-Policy',
    oneOf(
      'crossOriginResourcePolicy',
      options.crossOriginResourcePolicy ?? false,
      RESOURCE_POLICIES,
    ),
  )
  add(
    'Permissions-Policy',
    headerText('permissionsPolicy', options.permissionsPolicy ?? false),
  )

  return async (ctx, next) => {
    await next()
    for (const [name, value] of headers) {
      if (!ctx.headers.has(name)) ctx.headers.set(name, value)
    }
  }
}

function oneOf<T extends string>(
  option: string,
  value: T | false,
  allowed: readonly T[],
): string | undefined {
  if (value === false) return undefined
  if (allowed.includes(value)) return value
  throw new TypeError(
    `mix-secure-headers: ${option} must be one of ${allowed.join(', ')}, or false: ${JSON.stringify(value)}`,
  )
}

function hsts(value: boolean | HstsOptions): string | undefined {
  if (value === false) return undefined
  const {
    maxAge,
    includeSubDomains = false,
    preload = false,
  } = value === true ? { maxAge: ONE_YEAR } : value
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    throw new RangeError(
      `mix-secure-headers: hsts.maxAge must be an integer of 0 or more: ${maxAge}`,
    )
  }
  if (preload && (!includeSubDomains || maxAge < ONE_YEAR)) {
    throw new TypeError(
      'mix-secure-headers: hsts.preload requires includeSubDomains and a maxAge of at least 31536000',
    )
  }
  return [
    `max-age=${maxAge}`,
    includeSubDomains && 'includeSubDomains',
    preload && 'preload',
  ]
    .filter(Boolean)
    .join('; ')
}

const DIRECTIVE_NAME = /^[A-Za-z][A-Za-z0-9-]*$/
// A source is one token: whitespace, `;`, or `,` inside it would start another source, directive, or policy
const DIRECTIVE_VALUE = /^[!-+\--:<-~]+$/

function csp(value: CspDirectives | string | false): string | undefined {
  if (value === false) return undefined
  if (typeof value === 'string') return headerText('csp', value)
  const entries = Object.entries(value)
  const invalid = entries.find(
    ([name, sources]) =>
      !DIRECTIVE_NAME.test(name) ||
      !sources.every((source) => DIRECTIVE_VALUE.test(source)),
  )
  if (entries.length === 0 || invalid) {
    throw new TypeError(
      `mix-secure-headers: csp takes directives such as { 'default-src': ["'self'"] }, with one source per item: ${JSON.stringify(invalid ?? value)}`,
    )
  }
  return entries
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ')
}

function headerText(option: string, value: string | false): string | undefined {
  if (value === false) return undefined
  if (/^[ -~]+$/.test(value) && value.trim() !== '') return value
  throw new TypeError(
    `mix-secure-headers: ${option} must be a non-empty header value without line breaks or non-ASCII characters: ${JSON.stringify(value)}`,
  )
}
