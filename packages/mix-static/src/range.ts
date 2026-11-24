import type { Context } from '@imatomix/mixer'

/**
 * The byte range to send, `'unsatisfiable'` for 416, or undefined to send the whole file. Only a single range is
 * served: several ranges, or anything malformed, are ignored, which RFC 9110 allows and which keeps a request for
 * many small ranges from costing more than the file. If-Range is honored by ignoring Range, because mix-static's
 * ETag is weak and must not be used for it
 */
export function requestedRange(
  ctx: Context,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | undefined {
  const header = ctx.request.headers.get('range')
  if (header === null || ctx.method !== 'GET' || size === 0) return undefined
  if (ctx.request.headers.has('if-range')) return undefined
  const match = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(header.trim())
  if (!match) return undefined
  const [, first = '', last = ''] = match
  if (first === '' && last === '') return undefined

  if (first === '') {
    // The last N bytes
    const length = Number(last)
    if (length === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - length), end: size - 1 }
  }
  const start = Number(first)
  if (last !== '' && Number(last) < start) return undefined
  if (start >= size) return 'unsatisfiable'
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1)
  return { start, end }
}
