import type { ServerResponse } from 'node:http'
import type { Component, Context } from '@imatomix/mixer'

export type OriginMatcher =
  | string
  | RegExp
  | readonly (string | RegExp)[]
  | ((origin: string, ctx: Context) => boolean | Promise<boolean>)

export interface CorsOptions {
  /** Allowed origins. `'*'` allows any origin (cannot be combined with credentials) */
  origin?: OriginMatcher
  /** Allow requests with credentials such as cookies */
  credentials?: boolean
  methods?: readonly string[]
  /** When omitted, the headers requested in the preflight are allowed as is */
  allowHeaders?: readonly string[]
  exposeHeaders?: readonly string[]
  /** Number of seconds browsers may cache the preflight result */
  maxAge?: number
}

const DEFAULT_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
const DEFAULT_MAX_AGE = 600

export function cors(options: CorsOptions = {}): Component {
  const origin = toFullMatch(options.origin ?? '*')
  const allowsAnyOrigin = origin === '*'
  const credentials = options.credentials ?? false
  const methods = (options.methods ?? DEFAULT_METHODS).join(', ')
  const allowHeaders = options.allowHeaders?.join(', ')
  const exposeHeaders = options.exposeHeaders?.join(', ')
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE

  // Browsers reject '*' together with credentials. Working around it by echoing the Origin back would let
  // any site read responses with credentials, so treat it as a configuration error
  if (allowsAnyOrigin && credentials) {
    throw new Error(
      "mix-cors: origin: '*' cannot be combined with credentials: true. Specify the allowed origins instead",
    )
  }
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    throw new Error(
      `mix-cors: maxAge must be an integer of 0 or more: ${maxAge}`,
    )
  }

  return async (ctx) => {
    const { res } = ctx
    // When the response depends on the Origin, keep caches from reusing it for another Origin.
    // This also prevents a response without an Origin (and without CORS headers) from being cached and served to an allowed Origin,
    // so add it whether or not the request has an Origin header
    if (!allowsAnyOrigin) appendVary(res, 'Origin')

    const requestOrigin = ctx.req.headers.origin
    if (requestOrigin === undefined) return undefined

    const isPreflight =
      ctx.method === 'OPTIONS' &&
      ctx.req.headers['access-control-request-method'] !== undefined

    const allowed =
      allowsAnyOrigin || (await matchOrigin(origin, requestOrigin, ctx))

    if (allowed) {
      res.setHeader(
        'Access-Control-Allow-Origin',
        allowsAnyOrigin ? '*' : requestOrigin,
      )
      if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    if (!isPreflight) {
      if (allowed && exposeHeaders) {
        res.setHeader('Access-Control-Expose-Headers', exposeHeaders)
      }
      return undefined
    }

    if (allowed) {
      res.setHeader('Access-Control-Allow-Methods', methods)
      const headers =
        allowHeaders ?? ctx.req.headers['access-control-request-headers']
      if (allowHeaders === undefined) {
        appendVary(res, 'Access-Control-Request-Headers')
      }
      if (headers) res.setHeader('Access-Control-Allow-Headers', headers)
      res.setHeader('Access-Control-Max-Age', String(maxAge))
    }
    // Complete preflights from disallowed origins with 204 as well, so they never reach the application's handlers
    return null
  }
}

async function matchOrigin(
  matcher: OriginMatcher,
  origin: string,
  ctx: Context,
): Promise<boolean> {
  if (typeof matcher === 'function') return matcher(origin, ctx)
  const candidates = Array.isArray(matcher) ? matcher : [matcher]
  return candidates.some((candidate: string | RegExp) =>
    typeof candidate === 'string'
      ? candidate === origin
      : candidate.test(origin),
  )
}

/**
 * Regular expressions allow an Origin only when they match it entirely. An unanchored pattern such as `/example\.com/`,
 * or one that anchors only one side of an alternation such as `/^a|b$/`, would let `https://example.com.evil` through.
 * The g and y flags are dropped because lastIndex carries over and makes the result alternate
 */
function toFullMatch(matcher: OriginMatcher): OriginMatcher {
  const wrap = (pattern: RegExp) =>
    new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace(/[gy]/g, ''))
  if (matcher instanceof RegExp) return wrap(matcher)
  if (Array.isArray(matcher)) {
    return matcher.map((candidate: string | RegExp) =>
      candidate instanceof RegExp ? wrap(candidate) : candidate,
    )
  }
  return matcher
}

function appendVary(res: ServerResponse, field: string): void {
  const current = res.getHeader('Vary')
  const fields = String(current ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (
    fields.some(
      (value) => value === '*' || value.toLowerCase() === field.toLowerCase(),
    )
  ) {
    return
  }
  res.setHeader('Vary', [...fields, field].join(', '))
}
