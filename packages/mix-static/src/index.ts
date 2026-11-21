import { constants, realpathSync, statSync } from 'node:fs'
import { type FileHandle, open, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { type Component, type Context, HttpError } from '@imatomix/mixer'
import { contentTypeOf } from './mime.js'

export interface StaticOptions {
  /** このパス以下へのリクエストだけを扱う（セグメント単位で比較） */
  prefix?: string
  /** ディレクトリへのアクセスで返すファイル。false で無効 */
  index?: string | false
  /** Cache-Control の max-age（秒） */
  maxAge?: number
  /** `.env` や `.git/` のようなドットで始まるファイル・ディレクトリを配信する */
  dotfiles?: boolean
}

export function serveStatic(
  root: string,
  options: StaticOptions = {},
): Component {
  const rootPath = realpathSync(resolve(root))
  if (!statSync(rootPath).isDirectory()) {
    throw new Error(`mix-static: root がディレクトリではありません: ${root}`)
  }
  const prefix = splitSegments(options.prefix ?? '/').map(decodePrefixSegment)
  const index = options.index ?? 'index.html'
  const maxAge = options.maxAge ?? 0
  const dotfiles = options.dotfiles ?? false
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    throw new Error(
      `mix-static: maxAge は 0 以上の整数で指定してください: ${maxAge}`,
    )
  }
  if (index !== false && !isValidIndexName(index)) {
    throw new Error(
      `mix-static: index にはファイル名だけを指定してください: ${index}`,
    )
  }

  return async (ctx) => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return undefined

    const rawSegments = requestSegments(ctx.url.pathname)
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
      if (!ctx.url.pathname.endsWith('/')) {
        const indexStats = await statOrUndefined(join(filePath, index))
        if (!indexStats?.isFile()) return undefined
        return redirectToDirectory(ctx, rawSegments)
      }
      filePath = join(filePath, index)
      stats = await statOrUndefined(filePath)
      if (!stats) return undefined
    }
    if (!stats.isFile()) return undefined

    // シンボリックリンクで公開ディレクトリの外に出ていないか、実体のパスで確かめる
    const realFilePath = await realpath(filePath)
    if (!isInside(rootPath, realFilePath)) return undefined
    // root 内のシンボリックリンクがドットファイルを指していないか、実体のパスでも確かめる
    if (!dotfiles && hasDotSegment(relative(rootPath, realFilePath))) {
      return undefined
    }

    return sendFile(ctx, realFilePath, { maxAge })
  }
}

function splitSegments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

/**
 * 先頭と末尾の / は許すが、途中の空のセグメント（`//`）を含むパスは扱わない。
 * 空のセグメントを無視すると `//admin/x` を `/admin/x` として配信してしまい、
 * 生のパスの前方一致で認可する別の層と解釈が食い違うため
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
      `mix-static: prefix のエンコーディングが不正です: ${segment}`,
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
    // デコードしてから区切り文字や NUL が現れるものは、パスの解釈を変えうるので配信しない
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
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
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
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'
}

function redirectToDirectory(ctx: Context, rawSegments: string[]) {
  // 空のセグメントを詰めて必ず / 1 つで始める。`//host` のままだとプロトコル相対 URL として外部に飛ぶ
  const location = `/${rawSegments.map(encodeSafely).join('/')}/${ctx.url.search}`
  ctx.res.setHeader('Location', location)
  return ctx.send(301, null)
}

// ctx.url.pathname の各セグメントは既にエンコード済み。ただし '"' などはそのまま残るので念のため再エンコードしない範囲だけ通す
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
  // 検証後に最後の要素がシンボリックリンクへ差し替えられても、それをたどらない
  const handle: FileHandle = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  )
  try {
    // チェック後にファイルが差し替えられても、開いたものと同じファイルの情報を返す
    const stats = await handle.stat()
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`
    const lastModified = new Date(Math.floor(stats.mtimeMs / 1000) * 1000)

    const { res } = ctx
    res.setHeader('ETag', etag)
    res.setHeader('Last-Modified', lastModified.toUTCString())
    res.setHeader('Cache-Control', `public, max-age=${maxAge}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')

    if (isNotModified(ctx, etag, lastModified)) {
      await handle.close()
      return ctx.send(304, null)
    }

    res.setHeader('Content-Type', contentTypeOf(basename(filePath)))
    res.setHeader('Content-Length', stats.size)
    ctx.status = 200
    return handle.createReadStream()
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
  const ifNoneMatch = ctx.req.headers['if-none-match']
  if (ifNoneMatch !== undefined) {
    return ifNoneMatch
      .split(',')
      .map((tag) => tag.trim())
      .some((tag) => tag === '*' || weakTag(tag) === weakTag(etag))
  }
  const ifModifiedSince = ctx.req.headers['if-modified-since']
  if (ifModifiedSince !== undefined) {
    const since = Date.parse(ifModifiedSince)
    return !Number.isNaN(since) && lastModified.getTime() <= since
  }
  return false
}

function weakTag(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}
