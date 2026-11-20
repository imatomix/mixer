import { HttpError } from '@imatomix/mixer'

type Segment =
  | { kind: 'literal'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'wildcard' }

export type Pattern = readonly Segment[]

// 分割代入で受け取れる名前に限定する
const PARAM_NAME = /^[A-Za-z_$][\w$]*$/

export function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean)
}

export function compilePattern(path: string): Pattern {
  const parts = splitPath(path)
  const names = new Set<string>()
  return parts.map((part, index): Segment => {
    if (part === '*') {
      if (index !== parts.length - 1) {
        throw new Error(`"*" はパスの末尾にしか置けません: ${path}`)
      }
      return { kind: 'wildcard' }
    }
    if (part.startsWith(':')) {
      const name = part.slice(1)
      if (!PARAM_NAME.test(name)) {
        throw new Error(`パラメータ名が不正です: "${part}" in ${path}`)
      }
      if (names.has(name)) {
        throw new Error(`パラメータ名が重複しています: "${part}" in ${path}`)
      }
      names.add(name)
      return { kind: 'param', name }
    }
    // リクエスト側はデコードして比べるので、パターン側の固定パスも同じ規則でデコードしておく
    const value = decodeSegment(part)
    if (typeof value !== 'string') {
      throw new Error(`パスのエンコーディングが不正です: "${part}" in ${path}`)
    }
    return { kind: 'literal', value }
  })
}

export function hasDynamicSegment(path: string): boolean {
  return compilePattern(path).some((segment) => segment.kind !== 'literal')
}

const MALFORMED = Symbol('malformed')
const FORBIDDEN = Symbol('forbidden')

/**
 * デコード後に `/`・NUL を含むセグメントは、パストラバーサル等の入り口になるので FORBIDDEN として扱う
 */
function decodeSegment(
  segment: string,
): string | typeof MALFORMED | typeof FORBIDDEN {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return MALFORMED
  }
  if (decoded.includes('/') || decoded.includes('\0')) return FORBIDDEN
  return decoded
}

/**
 * リクエストのパスをセグメントごとにデコードする。
 * 不正なエンコーディングはクライアントの誤りなので 400、禁止文字を含むものはどのルートにもマッチさせない
 */
export function decodePath(pathname: string): string[] | undefined {
  const segments: string[] = []
  for (const raw of splitPath(pathname)) {
    const decoded = decodeSegment(raw)
    if (decoded === MALFORMED) {
      throw new HttpError(400, 'Malformed URL')
    }
    if (decoded === FORBIDDEN) return undefined
    segments.push(decoded)
  }
  return segments
}

export function matchPattern(
  pattern: Pattern,
  segments: readonly string[],
): Record<string, string> | undefined {
  const params: Record<string, string> = Object.create(null)
  for (const [index, segment] of pattern.entries()) {
    if (segment.kind === 'wildcard') {
      params['*'] = segments.slice(index).join('/')
      return params
    }
    const actual = segments[index]
    if (actual === undefined) return undefined
    if (segment.kind === 'param') {
      params[segment.name] = actual
    } else if (segment.value !== actual) {
      return undefined
    }
  }
  return segments.length === pattern.length ? params : undefined
}
