import type { IncomingMessage } from 'node:http'
import { HttpError } from './errors.js'

export const DEFAULT_BODY_LIMIT = 1024 * 1024 * 3

export type FormBody = Record<string, string | string[]>

export function readBuffer(
  req: IncomingMessage,
  limit = DEFAULT_BODY_LIMIT,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers['content-length'])
    if (declaredLength > limit) {
      req.resume()
      reject(new HttpError(413))
      return
    }

    const chunks: Buffer[] = []
    let received = 0

    const onData = (chunk: Buffer) => {
      received += chunk.length
      if (received > limit) {
        cleanup()
        // req.destroy() would close the socket and make the 413 response impossible, so drain the rest instead
        req.resume()
        reject(new HttpError(413))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

export function parseBody(
  buffer: Buffer,
  contentType: string | undefined,
): unknown {
  if (buffer.length === 0) return undefined

  const mimeType = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''

  if (mimeType === 'application/json' || mimeType.endsWith('+json')) {
    try {
      return JSON.parse(buffer.toString('utf8'))
    } catch (error) {
      throw new HttpError(400, 'Invalid JSON body', { cause: error })
    }
  }

  if (mimeType === 'application/x-www-form-urlencoded') {
    return parseForm(buffer.toString('utf8'))
  }

  if (mimeType === '' || mimeType.startsWith('text/')) {
    return buffer.toString('utf8')
  }

  return buffer
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
