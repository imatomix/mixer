import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHostCheck, isHostHeader, normalizeHost } from './hosts.js'

export interface ServeOptions {
  /** Defaults to 0 (any free port) */
  port?: number
  /** Defaults to 127.0.0.1 (this machine only). Pass '0.0.0.0' to accept connections from other machines, such as in a container */
  hostname?: string
  /**
   * Host names accepted in the Host header, besides localhost, *.localhost, 127.0.0.1, [::1], and an IP address
   * given as hostname. Compared exactly, ignoring case and the port. `true` accepts any host name
   */
  allowedHosts?: readonly string[] | true
}

export interface CloseOptions {
  /**
   * Milliseconds to wait for requests in progress before cutting their connections (defaults to 10000).
   * 0 cuts them at once
   */
  timeout?: number
}

export interface Server {
  readonly port: number
  /**
   * Stops accepting connections, closes idle ones, ends each connection once its requests have been answered,
   * and resolves when all are closed or the timeout has cut the rest
   */
  close(options?: CloseOptions): Promise<void>
}

const DEFAULT_CLOSE_TIMEOUT = 10_000

interface FetchApp {
  fetch: (request: Request) => Promise<Response>
  /** A mixer app's handle, which takes the peer's address; other fetch handlers are served through fetch */
  handle?: (
    request: Request,
    options: { remoteAddress?: string | undefined },
  ) => Promise<Response>
}

/** Serves a mixer app with Node's http module */
export async function serve(
  app: FetchApp,
  options: ServeOptions = {},
): Promise<Server> {
  const hostname = options.hostname ?? '127.0.0.1'
  const allowsHost = createHostCheck(options.allowedHosts, hostname)
  let warned = false
  const rejectHost = (host: string) => {
    if (warned) return
    warned = true
    // The host name passed the format check in requestUrl, so it cannot inject anything into the log
    console.warn(
      `mixer: rejected a request for the host name "${host}". To accept it, pass serve(app, { allowedHosts: ['${host}'] })`,
    )
  }

  // The requests in progress on each connection. While closing, a connection ends once its last request is
  // answered, so that a pipelined request or one that arrives meanwhile is not cut. Marking responses
  // Connection: close cannot do this: Node closes right after that response, and the mark is lost when the
  // headers are already sent (a stream) or the app sets its own Connection header.
  // Entries live until their socket closes (a WeakMap, so they never outlive it), which also means
  // 'close' is listened to once per connection
  const inProgress = new WeakMap<Socket, Set<ServerResponse>>()
  let closing = false
  const track = (socket: Socket) => {
    const responses = new Set<ServerResponse>()
    inProgress.set(socket, responses)
    socket.once('close', () => inProgress.delete(socket))
    return responses
  }

  const server = createServer((req, res) => {
    const socket = req.socket
    const responses = inProgress.get(socket) ?? track(socket)
    responses.add(res)
    res.once('close', () => {
      responses.delete(res)
      if (closing && responses.size === 0) socket.end()
    })
    handle(app, req, res, allowsHost, rejectHost).catch((error: unknown) => {
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
    server.listen(options.port ?? 0, hostname, () => {
      server.off('error', reject)
      const { port } = server.address() as AddressInfo
      resolve({
        port,
        close: ({ timeout = DEFAULT_CLOSE_TIMEOUT } = {}) => {
          if (!Number.isFinite(timeout) || timeout < 0) {
            return Promise.reject(
              new RangeError(
                `mixer: close() timeout must be a finite number of 0 or more (milliseconds): ${timeout}`,
              ),
            )
          }
          // A request that arrives just as its connection ends is lost; HTTP/1.1 clients retry such requests
          // (RFC 9112, 9.3.1)
          closing = true
          return new Promise<void>((done, fail) => {
            // Cutting the connections aborts ctx.request.signal of the requests still in progress
            const timer = setTimeout(
              () => server.closeAllConnections(),
              timeout,
            )
            server.close((error) => {
              clearTimeout(timer)
              if (error) fail(error)
              else done()
            })
            server.closeIdleConnections()
          })
        },
      })
    })
  })
}

async function handle(
  app: FetchApp,
  req: IncomingMessage,
  res: ServerResponse,
  allowsHost: (host: string) => boolean,
  rejectHost: (host: string) => void,
): Promise<void> {
  const url = requestUrl(req)
  const host = url && normalizeHost(url.hostname)
  if (!url || !host || !allowsHost(host)) {
    if (host) rejectHost(host)
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

  const response = app.handle
    ? await app.handle(request, { remoteAddress: req.socket.remoteAddress })
    : await app.fetch(request)
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

  if (!isHostHeader(host)) return undefined
  try {
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
