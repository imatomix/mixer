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

// コンポーネントが先に Content-Type を決めていればそれを尊重する
function setDefaultContentType(res: ServerResponse, type: string): void {
  if (!res.hasHeader('Content-Type')) {
    res.setHeader('Content-Type', type)
  }
}
