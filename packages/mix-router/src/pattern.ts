type Segment =
  | { kind: 'literal'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'wildcard' }

export type Pattern = readonly Segment[]

export function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean)
}

export function compilePattern(path: string): Pattern {
  const parts = splitPath(path)
  return parts.map((part, index): Segment => {
    if (part === '*') {
      if (index !== parts.length - 1) {
        throw new Error(`"*" はパスの末尾にしか置けません: ${path}`)
      }
      return { kind: 'wildcard' }
    }
    if (part.startsWith(':')) {
      return { kind: 'param', name: part.slice(1) }
    }
    return { kind: 'literal', value: part }
  })
}

export function hasDynamicSegment(path: string): boolean {
  return compilePattern(path).some((segment) => segment.kind !== 'literal')
}

/**
 * 1 セグメント分をデコードする。不正なエンコーディングや、デコード後に `/`・NUL を含むものは
 * パストラバーサル等の入り口になるため undefined を返してマッチさせない
 */
function decodeSegment(segment: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return undefined
  }
  if (decoded.includes('/') || decoded.includes('\0')) return undefined
  return decoded
}

export function matchPattern(
  pattern: Pattern,
  rawSegments: readonly string[],
): Record<string, string> | undefined {
  const segments: string[] = []
  for (const raw of rawSegments) {
    const decoded = decodeSegment(raw)
    if (decoded === undefined) return undefined
    segments.push(decoded)
  }

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
