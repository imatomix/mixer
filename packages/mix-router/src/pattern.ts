import { HttpError } from '@imatomix/mixer'

type Segment =
  | { kind: 'literal'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'wildcard' }

export type Pattern = readonly Segment[]

// Only names that can be destructured
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
        throw new Error(`"*" can only be the last segment of a path: ${path}`)
      }
      return { kind: 'wildcard' }
    }
    if (part.startsWith(':')) {
      const name = part.slice(1)
      if (!PARAM_NAME.test(name)) {
        throw new Error(`Invalid parameter name: "${part}" in ${path}`)
      }
      if (names.has(name)) {
        throw new Error(`Duplicate parameter name: "${part}" in ${path}`)
      }
      names.add(name)
      return { kind: 'param', name }
    }
    // Requests are compared after decoding, so decode the literal segments of the pattern the same way
    const value = decodeSegment(part)
    if (typeof value !== 'string') {
      throw new Error(`Invalid percent-encoding in path: "${part}" in ${path}`)
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
 * Segments that contain `/` or NUL after decoding can lead to path traversal, so they are treated as FORBIDDEN
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
 * Decodes the request path segment by segment.
 * Malformed encoding is a client error (400); segments with forbidden characters match no route
 */
export function decodePath(pathname: string): string[] | undefined {
  const rawSegments = requestSegments(pathname)
  if (!rawSegments) return undefined
  const segments: string[] = []
  for (const raw of rawSegments) {
    const decoded = decodeSegment(raw)
    if (decoded === MALFORMED) {
      throw new HttpError(400, 'Malformed URL')
    }
    if (decoded === FORBIDDEN) return undefined
    segments.push(decoded)
  }
  return segments
}

/**
 * Leading and trailing slashes are allowed, but a path with an empty segment in the middle (`//`) matches no route.
 * Ignoring empty segments would let `//admin/x` reach the `/admin/x` route,
 * which disagrees with other layers that authorize by a prefix of the raw path
 */
function requestSegments(pathname: string): string[] | undefined {
  const parts = pathname.split('/').slice(1)
  if (parts.at(-1) === '') parts.pop()
  return parts.includes('') ? undefined : parts
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
