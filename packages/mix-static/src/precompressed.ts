import type { Stats } from 'node:fs'
import { type FileHandle, open } from 'node:fs/promises'
import type { Context } from '@imatomix/mixer'
import { OPEN_FLAGS } from './files.js'

export type Encoding = 'br' | 'gzip'

export const EXTENSIONS: Record<Encoding, string> = { br: '.br', gzip: '.gz' }

/**
 * Opens the compressed file to send instead of the original, if the client accepts one. It sits next to the real
 * path of the original, which passed every safety check, and is opened without following a symbolic link
 */
export async function openVariant(
  ctx: Context,
  filePath: string,
  original: Stats,
): Promise<
  { handle: FileHandle; stats: Stats; encoding: Encoding } | undefined
> {
  for (const encoding of acceptedEncodings(
    ctx.request.headers.get('accept-encoding'),
  )) {
    let handle: FileHandle
    try {
      handle = await open(filePath + EXTENSIONS[encoding], OPEN_FLAGS)
    } catch {
      continue
    }
    const stats = await handle.stat().catch(() => undefined)
    // A compressed file older than the original would send outdated content
    if (stats?.isFile() && stats.mtimeMs >= original.mtimeMs) {
      return { handle, stats, encoding }
    }
    await handle.close()
  }
  return undefined
}

/**
 * The encodings we can serve that Accept-Encoding allows and ranks at least as high as no encoding, most preferred
 * first (Brotli on a tie)
 */
export function acceptedEncodings(header: string | null): Encoding[] {
  if (header === null) return []
  const weights = new Map<string, number>()
  for (const item of header.split(',')) {
    const [name = '', ...params] = item.split(';').map((part) => part.trim())
    const q = params.find((param) => /^q=/i.test(param))
    const weight = q === undefined ? 1 : Number(q.slice(2))
    weights.set(name.toLowerCase(), Number.isFinite(weight) ? weight : 0)
  }
  const any = weights.get('*') ?? 0
  // An uncompressed response the client ranks higher wins; on a tie, the smaller compressed file is sent
  const identity = weights.get('identity') ?? weights.get('*') ?? 0
  return (['br', 'gzip'] as const)
    .map((encoding) => ({ encoding, weight: weights.get(encoding) ?? any }))
    .filter(({ weight }) => weight > 0 && weight >= identity)
    .sort((a, b) => b.weight - a.weight)
    .map(({ encoding }) => encoding)
}

export function addVary(headers: Headers, field: string): void {
  const fields = (headers.get('Vary') ?? '')
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
  headers.set('Vary', [...fields, field].join(', '))
}
