import { HttpError } from './errors.js'

export const DEFAULT_BODY_LIMIT = 1024 * 1024 * 3

/** A limit that is not a whole number of bytes would silently disable the check */
export function checkBodyLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError(
      `mixer: bodyLimit must be an integer of 0 or more (bytes): ${limit}`,
    )
  }
}

export async function readBytes(
  request: Request,
  limit = DEFAULT_BODY_LIMIT,
): Promise<Uint8Array> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) {
      throw new HttpError(400, 'Invalid Content-Length')
    }
    if (Number(declared) > limit) throw new HttpError(413)
  }
  if (!request.body) return new Uint8Array(0)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > limit) {
      // Stop reading instead of draining a body that is already too large
      await reader.cancel().catch(() => {})
      throw new HttpError(413)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** The media type of a Content-Type header, lowercased and without parameters */
export function mediaType(contentType: string | null): string {
  return contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isJson(contentType: string | null): boolean {
  const type = mediaType(contentType)
  return type === 'application/json' || /^application\/[^/]+\+json$/.test(type)
}

export function isForm(contentType: string | null): boolean {
  const type = mediaType(contentType)
  return (
    type === 'application/x-www-form-urlencoded' ||
    type === 'multipart/form-data'
  )
}

export function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new HttpError(400, 'Invalid JSON body', { cause: error })
  }
}

// The bytes were read within bodyLimit, so the Web standard parser cannot be made to buffer more than that
export async function parseForm(
  bytes: Uint8Array,
  contentType: string,
): Promise<FormData> {
  try {
    return await new Response(bytes, {
      headers: { 'content-type': contentType },
    }).formData()
  } catch (error) {
    throw new HttpError(400, 'Invalid form body', { cause: error })
  }
}
