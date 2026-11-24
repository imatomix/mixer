import { realpathSync, statSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { Component, Context } from '@imatomix/mixer'
import { isNotFound } from './files.js'
import {
  decodePrefixSegment,
  decodeSegments,
  hasDotSegment,
  isInside,
  isServableSegment,
  isValidIndexName,
  requestSegments,
  splitSegments,
  startsWithPrefix,
} from './paths.js'
import { cacheControl, sendFile } from './send-file.js'

export interface StaticOptions {
  /** Only handle requests under this path (compared segment by segment) */
  prefix?: string
  /** File returned for directory requests. false disables it */
  index?: string | false
  /** max-age of Cache-Control, in seconds */
  maxAge?: number
  /**
   * Add `immutable` to Cache-Control, for files whose content never changes under the same name (such as
   * fingerprinted build output). Requires a maxAge
   */
  immutable?: boolean
  /** Serve files and directories whose names start with a dot, such as `.env` or `.git/` */
  dotfiles?: boolean
  /**
   * Serve `file.br` or `file.gz` next to a file instead of it when the client accepts that encoding and the
   * compressed file is not older than the original (defaults to false)
   */
  precompressed?: boolean
}

export function serveStatic(
  root: string,
  options: StaticOptions = {},
): Component {
  const rootPath = realpathSync(resolve(root))
  if (!statSync(rootPath).isDirectory()) {
    throw new Error(`mix-static: root is not a directory: ${root}`)
  }
  const prefix = splitSegments(options.prefix ?? '/').map(decodePrefixSegment)
  const index = options.index ?? 'index.html'
  const maxAge = options.maxAge ?? 0
  const dotfiles = options.dotfiles ?? false
  const precompressed = options.precompressed ?? false
  const cache = cacheControl(maxAge, options.immutable ?? false)
  if (index !== false && !isValidIndexName(index)) {
    throw new TypeError(
      `mix-static: index must be a file name only: ${JSON.stringify(index)}`,
    )
  }

  return async (ctx) => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return undefined

    const rawSegments = requestSegments(ctx.path)
    if (!rawSegments) return undefined
    const segments = decodeSegments(rawSegments)
    if (!segments || !startsWithPrefix(segments, prefix)) return undefined

    const relativeSegments = segments.slice(prefix.length)
    if (
      !relativeSegments.every((segment) => isServableSegment(segment, dotfiles))
    ) {
      return undefined
    }

    let filePath = join(rootPath, ...relativeSegments)
    let stats = await statOrUndefined(filePath)
    if (!stats) return undefined

    if (stats.isDirectory()) {
      if (index === false) return undefined
      // Check the full pathname: under basePath, ctx.path for `/api` is `/`, but the browser resolves
      // relative links against `/api`, so it still needs the redirect to `/api/`
      if (!ctx.url.pathname.endsWith('/')) {
        const indexStats = await statOrUndefined(join(filePath, index))
        if (!indexStats?.isFile()) return undefined
        return redirectToDirectory(ctx)
      }
      filePath = join(filePath, index)
      stats = await statOrUndefined(filePath)
      if (!stats) return undefined
    }
    if (!stats.isFile()) return undefined

    // Check the real path to make sure a symbolic link does not lead outside the public directory
    const realFilePath = await realpath(filePath)
    if (!isInside(rootPath, realFilePath)) return undefined
    // Also check the real path to make sure a symbolic link inside root does not point to a dotfile
    if (!dotfiles && hasDotSegment(relative(rootPath, realFilePath))) {
      return undefined
    }

    return sendFile(ctx, realFilePath, { cacheControl: cache, precompressed })
  }
}

export function redirectToDirectory(ctx: Context) {
  // The location is built from the full pathname so that it keeps basePath.
  // Paths with empty segments are not redirected: `//host` would be a protocol-relative URL to another site
  const segments = requestSegments(ctx.url.pathname)
  if (!segments) return undefined
  ctx.status = 301
  ctx.headers.set(
    'Location',
    `/${segments.map(encodeSafely).join('/')}/${ctx.url.search}`,
  )
  return null
}

// Segments of ctx.url.pathname are already encoded, but characters such as '"' remain as is, so encode anything outside the safe set
export function encodeSafely(segment: string): string {
  return segment.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@%]/g, (char) =>
    encodeURIComponent(char),
  )
}

export async function statOrUndefined(path: string) {
  try {
    return await stat(path)
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}
