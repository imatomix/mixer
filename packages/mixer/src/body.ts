import { HttpError } from './errors.js'

export const DEFAULT_BODY_LIMIT = 1024 * 1024 * 3

export type FormBody = Record<string, string | string[]>

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

export function parseBody(
  bytes: Uint8Array,
  contentType: string | null,
): unknown {
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
    return parseForm(text())
  }

  if (mimeType === '' || mimeType.startsWith('text/')) {
    return text()
  }

  return bytes
}

function parseForm(text: string): FormBody {
  // With a plain object, __proto__ would replace the prototype and keys would mix with inherited values such as constructor
  const form: FormBody = Object.create(null)
  for (const [key, value] of new URLSearchParams(text)) {
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
