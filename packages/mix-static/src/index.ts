import { constants, realpathSync, statSync } from 'node:fs'
import { type FileHandle, open, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { type Component, type Context, HttpError } from '@imatomix/mixer'
import { contentTypeOf } from './mime.js'

export interface StaticOptions {
  /** Only handle requests under this path (compared segment by segment) */
  prefix?: string
  /** File returned for directory requests. false disables it */
  index?: string | false
  /** max-age of Cache-Control, in seconds */
  maxAge?: number
  /** Serve files and directories whose names start with a dot, such as `.env` or `.git/` */
  dotfiles?: boolean
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
  validateMaxAge(maxAge)
  if (index !== false && !isValidIndexName(index)) {
    throw new Error(`mix-static: index must be a file name only: ${index}`)
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

    return sendFile(ctx, realFilePath, { maxAge })
  }
}

export interface FileOptions {
  /** max-age of Cache-Control, in seconds */
  maxAge?: number
}

/**
 * A Component that always returns the given file. It does not check the path, so combine it with
 * mix-router or similar, as in `get('/favicon.ico', serveFile('./favicon.ico'))`
 */
export function serveFile(
  filePath: string,
  options: FileOptions = {},
): Component {
  const realFilePath = realpathSync(resolve(filePath))
  if (!statSync(realFilePath).isFile()) {
    throw new Error(`mix-static: not a regular file: ${filePath}`)
  }
  const maxAge = options.maxAge ?? 0
  validateMaxAge(maxAge)

  return (ctx) => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return undefined
    return sendFile(ctx, realFilePath, { maxAge })
  }
}

function splitSegments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

/**
 * Leading and trailing slashes are allowed, but paths with an empty segment in the middle (`//`) are not served.
 * Ignoring empty segments would serve `//admin/x` as `/admin/x`,
 * which disagrees with other layers that authorize by a prefix of the raw path
 */
function requestSegments(pathname: string): string[] | undefined {
  const parts = pathname.split('/').slice(1)
  if (parts.at(-1) === '') parts.pop()
  return parts.includes('') ? undefined : parts
}

function isValidIndexName(name: string): boolean {
  return name !== '' && !name.startsWith('.') && !/[/\\\0]/.test(name)
}

function hasDotSegment(path: string): boolean {
  return path.split(sep).some((segment) => segment.startsWith('.'))
}

function decodePrefixSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new Error(
      `mix-static: invalid percent-encoding in prefix: ${segment}`,
    )
  }
}

function decodeSegments(rawSegments: string[]): string[] | undefined {
  const segments: string[] = []
  for (const raw of rawSegments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      throw new HttpError(400, 'Malformed URL')
    }
    // Segments that contain separators or NUL after decoding could change how the path is interpreted, so they are not served
    if (/[/\\\0]/.test(decoded)) return undefined
    segments.push(decoded)
  }
  return segments
}

function startsWithPrefix(segments: string[], prefix: string[]): boolean {
  return prefix.every((segment, i) => segments[i] === segment)
}

function isServableSegment(segment: string, dotfiles: boolean): boolean {
  if (segment === '.' || segment === '..') return false
  return dotfiles || !segment.startsWith('.')
}

function isInside(rootPath: string, target: string): boolean {
  const path = relative(rootPath, target)
  // Compare whole segments: a file named `..foo` inside root is fine, `../foo` is outside
  const outside = path === '..' || path.startsWith(`..${sep}`)
  return path !== '' && !outside && !isAbsolute(path)
}

async function statOrUndefined(path: string) {
  try {
    return await stat(path)
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

function validateMaxAge(maxAge: number): void {
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    throw new Error(
      `mix-static: maxAge must be an integer of 0 or more: ${maxAge}`,
    )
  }
}

function redirectToDirectory(ctx: Context) {
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
function encodeSafely(segment: string): string {
  return segment.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@%]/g, (char) =>
    encodeURIComponent(char),
  )
}

async function sendFile(
  ctx: Context,
  filePath: string,
  { maxAge }: { maxAge: number },
) {
  let handle: FileHandle
  try {
    // Do not follow a symbolic link even if the last component was replaced with one after the checks
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    // Do not serve files that disappeared or were replaced with a symbolic link (ELOOP) after the checks
    if (isNotFound(error) || errorCode(error) === 'ELOOP') return undefined
    throw error
  }
  try {
    // Return the metadata of the file that was actually opened, even if the path was replaced after the checks
    const stats = await handle.stat()
    if (!stats.isFile()) {
      await handle.close()
      return undefined
    }
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`
    const lastModified = new Date(Math.floor(stats.mtimeMs / 1000) * 1000)

    const { headers } = ctx
    headers.set('ETag', etag)
    headers.set('Last-Modified', lastModified.toUTCString())
    headers.set('Cache-Control', `public, max-age=${maxAge}`)

    if (isNotModified(ctx, etag, lastModified)) {
      await handle.close()
      ctx.status = 304
      return null
    }

    headers.set('Content-Type', contentTypeOf(basename(filePath)))
    headers.set('Content-Length', String(stats.size))
    ctx.status = 200
    // The read stream closes the file when it ends or is destroyed, and cancelling the Web stream
    // (HEAD, a client that went away) destroys it
    return Readable.toWeb(
      handle.createReadStream(),
    ) as ReadableStream<Uint8Array>
  } catch (error) {
    await handle.close()
    throw error
  }
}

function isNotModified(
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

function weakTag(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}
