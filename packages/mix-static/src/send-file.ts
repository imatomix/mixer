import { type FileHandle, open } from 'node:fs/promises'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { type Context, HttpError } from '@imatomix/mixer'
import { isNotModified } from './conditional.js'
import { errorCode, isNotFound, OPEN_FLAGS } from './files.js'
import { contentTypeOf } from './mime.js'
import { addVary, type Encoding, openVariant } from './precompressed.js'
import { requestedRange } from './range.js'

export async function sendFile(
  ctx: Context,
  filePath: string,
  {
    cacheControl,
    precompressed = false,
  }: { cacheControl: string; precompressed?: boolean },
) {
  let handle: FileHandle
  try {
    // Do not follow a symbolic link even if the last component was replaced with one after the checks
    handle = await open(filePath, OPEN_FLAGS)
  } catch (error) {
    // Do not serve files that disappeared or were replaced with a symbolic link (ELOOP) after the checks
    if (isNotFound(error) || errorCode(error) === 'ELOOP') return undefined
    throw error
  }
  try {
    // Return the metadata of the file that was actually opened, even if the path was replaced after the checks
    let stats = await handle.stat()
    if (!stats.isFile()) {
      await handle.close()
      return undefined
    }

    const { headers } = ctx
    let encoding: Encoding | undefined
    if (precompressed) {
      // The response depends on Accept-Encoding whichever file is sent
      addVary(headers, 'Accept-Encoding')
      const variant = await openVariant(ctx, filePath, stats)
      if (variant) {
        await handle.close()
        ;({ handle, stats, encoding } = variant)
        headers.set('Content-Encoding', encoding)
      }
    }
    const tag = `${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}`
    const etag = `W/"${encoding ? `${tag}-${encoding}` : tag}"`
    const lastModified = new Date(Math.floor(stats.mtimeMs / 1000) * 1000)

    headers.set('ETag', etag)
    headers.set('Last-Modified', lastModified.toUTCString())
    headers.set('Cache-Control', cacheControl)
    headers.set('Accept-Ranges', 'bytes')

    if (isNotModified(ctx, etag, lastModified)) {
      await handle.close()
      ctx.status = 304
      return null
    }

    const range = requestedRange(ctx, stats.size)
    if (range === 'unsatisfiable') {
      // Thrown, so that the app's onError can shape it like any other error; the catch below closes the file
      throw new HttpError(416, 'Range Not Satisfiable', {
        headers: { 'Content-Range': `bytes */${stats.size}` },
      })
    }

    headers.set('Content-Type', contentTypeOf(basename(filePath)))
    if (range) {
      ctx.status = 206
      headers.set(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${stats.size}`,
      )
      headers.set('Content-Length', String(range.end - range.start + 1))
    } else {
      ctx.status = 200
      headers.set('Content-Length', String(stats.size))
    }
    // The read stream closes the file when it ends or is destroyed, and cancelling the Web stream
    // (HEAD, a client that went away) destroys it
    return Readable.toWeb(
      handle.createReadStream(range ?? {}),
    ) as ReadableStream<Uint8Array>
  } catch (error) {
    await handle.close()
    throw error
  }
}

export function cacheControl(maxAge: number, immutable: boolean): string {
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    throw new RangeError(
      `mix-static: maxAge must be an integer of 0 or more: ${maxAge}`,
    )
  }
  if (!immutable) return `public, max-age=${maxAge}`
  // immutable means "do not revalidate before max-age runs out", which says nothing with a max-age of 0
  if (maxAge === 0) {
    throw new TypeError('mix-static: immutable needs a maxAge of 1 or more')
  }
  return `public, max-age=${maxAge}, immutable`
}
