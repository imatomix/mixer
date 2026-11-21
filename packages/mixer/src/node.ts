import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface ServeOptions {
  /** Defaults to 0 (any free port) */
  port?: number
  hostname?: string
}

export interface Server {
  readonly port: number
  close(): Promise<void>
}

interface FetchApp {
  fetch: (request: Request) => Promise<Response>
}

/** Serves a mixer app with Node's http module */
export function serve(
  app: FetchApp,
  options: ServeOptions = {},
): Promise<Server> {
  const server = createServer((req, res) => {
    handle(app, req, res).catch((error: unknown) => {
      console.error(error)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end()
      } else {
        res.destroy()
      }
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, options.hostname, () => {
      server.off('error', reject)
      const { port } = server.address() as AddressInfo
      resolve({
        port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
            server.closeAllConnections()
          }),
      })
    })
  })
}

async function handle(
  app: FetchApp,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = requestUrl(req)
  if (!url) {
    res.writeHead(400, { 'Content-Length': '0', Connection: 'close' })
    res.end()
    return
  }

  const controller = new AbortController()
  // 'close' before the response has finished means the client went away
  res.once('close', () => {
    if (!res.writableFinished) controller.abort()
  })

  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const request = new Request(url, {
    method,
    headers: requestHeaders(req),
    signal: controller.signal,
    ...(hasBody
      ? {
          body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
          duplex: 'half',
        }
      : {}),
  } as RequestInit)

  const response = await app.fetch(request)
  await writeResponse(req, res, response)
}

/**
 * Builds the request URL from the Host header and the request target. The path is concatenated
 * as a string, because parsing `//admin/x` against a base would turn `admin` into the host.
 * Anything that is not a single, plain host[:port] is rejected
 */
function requestUrl(req: IncomingMessage): URL | undefined {
  const hosts: string[] = []
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.toLowerCase() === 'host')
      hosts.push(req.rawHeaders[i + 1] ?? '')
  }
  if (hosts.length !== 1) return undefined
  const host = (hosts[0] ?? '').toLowerCase()

  const target = req.url ?? ''
  let pathAndQuery: string
  if (target.startsWith('/')) {
    pathAndQuery = target
  } else if (/^https?:\/\//i.test(target)) {
    try {
      const absolute = new URL(target)
      pathAndQuery = `${absolute.pathname}${absolute.search}`
    } catch {
      return undefined
    }
  } else {
    return undefined
  }

  try {
    const origin = new URL(`http://${host}`)
    const plainHost =
      origin.host === host &&
      origin.username === '' &&
      origin.password === '' &&
      origin.pathname === '/' &&
      origin.search === '' &&
      origin.hash === '' &&
      (origin.port === '' || Number(origin.port) > 0)
    if (!plainHost) return undefined
    return new URL(`http://${host}${pathAndQuery}`)
  } catch {
    return undefined
  }
}

function requestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]
    const value = req.rawHeaders[i + 1]
    if (name !== undefined && value !== undefined) headers.append(name, value)
  }
  return headers
}

async function writeResponse(
  req: IncomingMessage,
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status
  if (response.statusText) res.statusMessage = response.statusText
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') res.setHeader(name, value)
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) res.setHeader('Set-Cookie', cookies)
  // The rest of an unread request body (for example after a 413) is not drained; close the connection instead
  if (!req.complete) res.setHeader('Connection', 'close')

  if (!response.body) {
    res.end()
    return
  }
  try {
    // pipeline keeps backpressure, and cancels the Web stream when the client disconnects
    await pipeline(Readable.fromWeb(response.body as never), res)
  } catch (error) {
    if (!isClientGone(error)) throw error
  }
}

function isClientGone(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return (
    code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE'
  )
}
