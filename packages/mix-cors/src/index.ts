import type { ServerResponse } from 'node:http'
import type { Component, Context } from '@imatomix/mixer'

export type OriginMatcher =
  | string
  | RegExp
  | readonly (string | RegExp)[]
  | ((origin: string, ctx: Context) => boolean | Promise<boolean>)

export interface CorsOptions {
  /** 許可する Origin。`'*'` はすべて許可（credentials とは併用できない） */
  origin?: OriginMatcher
  /** Cookie などの資格情報付きリクエストを許可する */
  credentials?: boolean
  methods?: readonly string[]
  /** 省略時は preflight で要求されたヘッダをそのまま許可する */
  allowHeaders?: readonly string[]
  exposeHeaders?: readonly string[]
  /** preflight の結果をブラウザがキャッシュする秒数 */
  maxAge?: number
}

const DEFAULT_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
const DEFAULT_MAX_AGE = 600

export function cors(options: CorsOptions = {}): Component {
  const origin = options.origin ?? '*'
  const allowsAnyOrigin = origin === '*'
  const credentials = options.credentials ?? false
  const methods = (options.methods ?? DEFAULT_METHODS).join(', ')
  const allowHeaders = options.allowHeaders?.join(', ')
  const exposeHeaders = options.exposeHeaders?.join(', ')
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE

  // ブラウザは '*' と資格情報の併用を拒否する。Origin をそのまま返して回避すると
  // どのサイトからでも資格情報付きで読めてしまうため、設定ミスとして弾く
  if (allowsAnyOrigin && credentials) {
    throw new Error(
      "mix-cors: origin: '*' と credentials: true は併用できません。許可する origin を指定してください",
    )
  }
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    throw new Error(
      `mix-cors: maxAge は 0 以上の整数で指定してください: ${maxAge}`,
    )
  }

  return async (ctx) => {
    const requestOrigin = ctx.req.headers.origin
    if (requestOrigin === undefined) return undefined

    const { res } = ctx
    const isPreflight =
      ctx.method === 'OPTIONS' &&
      ctx.req.headers['access-control-request-method'] !== undefined

    // 応答が Origin によって変わる場合、キャッシュが別の Origin に使い回さないようにする
    if (!allowsAnyOrigin) appendVary(res, 'Origin')

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
    // 許可しない Origin にも 204 で応答を完結させ、アプリ側のハンドラに preflight を流さない
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
      : testRegExp(candidate, origin),
  )
}

// g / y フラグ付きの正規表現は lastIndex を持ち越し、同じ入力でも結果が交互に変わるので毎回戻す
function testRegExp(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0
  return pattern.test(value)
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
