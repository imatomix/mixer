import type { Context } from '@imatomix/mixer'

export function isNotModified(
  ctx: Context,
  etag: string,
  lastModified: Date,
): boolean {
  const ifNoneMatch = ctx.request.headers.get('if-none-match')
  if (ifNoneMatch !== null) {
    return ifNoneMatch
      .split(',')
      .map((tag) => tag.trim())
      .some((tag) => tag === '*' || weakTag(tag) === weakTag(etag))
  }
  const ifModifiedSince = ctx.request.headers.get('if-modified-since')
  if (ifModifiedSince !== null) {
    const since = Date.parse(ifModifiedSince)
    return !Number.isNaN(since) && lastModified.getTime() <= since
  }
  return false
}

export function weakTag(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}
