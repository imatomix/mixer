import type { ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export async function sendResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
): Promise<void> {
  if (body === undefined || body === null) {
    res.statusCode = status === 200 ? 204 : status
    res.end()
    return
  }

  res.statusCode = status

  if (body instanceof Readable) {
    setDefaultContentType(res, 'application/octet-stream')
    // HEAD responses have no body, so do not read files and other streams to the end for nothing
    if (res.req?.method === 'HEAD') {
      body.destroy()
      res.end()
      return
    }
    await pipeline(body, res)
    return
  }

  let payload: string | Uint8Array
  if (body instanceof Uint8Array) {
    setDefaultContentType(res, 'application/octet-stream')
    payload = body
  } else if (typeof body === 'string') {
    setDefaultContentType(res, 'text/plain; charset=utf-8')
    payload = body
  } else {
    setDefaultContentType(res, 'application/json; charset=utf-8')
    payload = JSON.stringify(body)
  }

  res.setHeader('Content-Length', Buffer.byteLength(payload))
  res.end(payload)
}

// Respect a Content-Type that a component has already set
function setDefaultContentType(res: ServerResponse, type: string): void {
  if (!res.hasHeader('Content-Type')) {
    res.setHeader('Content-Type', type)
  }
}
