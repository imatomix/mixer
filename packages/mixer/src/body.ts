import { HttpError } from './errors.js'

export const DEFAULT_BODY_LIMIT = 1024 * 1024 * 3

export type FormBody = Record<string, string | string[]>

/** A multipart/form-data body: fields are strings and uploads are Files, repeated names become arrays */
export type MultipartBody = Record<string, string | File | (string | File)[]>

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

export async function parseBody(
  bytes: Uint8Array,
  contentType: string | null,
): Promise<unknown> {
  if (bytes.length === 0) return undefined
  const text = () => new TextDecoder().decode(bytes)

  const mimeType = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''

  if (mimeType === 'application/json' || mimeType.endsWith('+json')) {
    try {
      return JSON.parse(text())
    } catch (error) {
      throw new HttpError(400, 'Invalid JSON body', { cause: error })
    }
  }

  if (mimeType === 'application/x-www-form-urlencoded') {
    return collectFields(new URLSearchParams(text()))
  }

  if (mimeType === 'multipart/form-data') {
    return parseMultipart(bytes, contentType ?? '')
  }

  if (mimeType === '' || mimeType.startsWith('text/')) {
    return text()
  }

  return bytes
}

// The bytes were read within bodyLimit, so the Web standard parser cannot be made to buffer more than that
async function parseMultipart(
  bytes: Uint8Array,
  contentType: string,
): Promise<MultipartBody> {
  let form: FormData
  try {
    form = await new Response(bytes, {
      headers: { 'content-type': contentType },
    }).formData()
  } catch (error) {
    throw new HttpError(400, 'Invalid multipart body', { cause: error })
  }
  return collectFields(form)
}

function collectFields<V>(
  entries: Iterable<[string, V]>,
): Record<string, V | V[]> {
  // With a plain object, __proto__ would replace the prototype and keys would mix with inherited values such as constructor
  const form: Record<string, V | V[]> = Object.create(null)
  for (const [key, value] of entries) {
    const existing = form[key]
    if (existing === undefined) {
      form[key] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      form[key] = [existing, value]
    }
  }
  return form
}
