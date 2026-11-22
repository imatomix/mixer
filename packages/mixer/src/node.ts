import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { type AddressInfo, isIP, type Socket } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

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
   * Stops accepting connections, closes idle ones, and resolves once the requests in progress have been
   * answered (with `Connection: close`) or the timeout has cut them
   */
  close(options?: CloseOptions): Promise<void>
}

const DEFAULT_CLOSE_TIMEOUT = 10_000

interface FetchApp {
  fetch: (request: Request) => Promise<Response>
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

  // Requests still being handled on each connection. While closing, a connection ends when its last one is
  // answered: ending it earlier would cut a pipelined request, and leaving it to Connection: close fails when
  // the headers are already sent (a stream) or the app answered with its own Connection header
  const inProgress = new Map<Socket, Set<ServerResponse>>()
  let closing = false

  const server = createServer((req, res) => {
    const socket = req.socket
    const responses = inProgress.get(socket) ?? new Set()
    inProgress.set(socket, responses.add(res))
    res.once('close', () => {
      responses.delete(res)
      if (responses.size > 0) return
      inProgress.delete(socket)
      if (closing) socket.end()
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
                `close timeout must be a finite number of milliseconds, 0 or more: ${timeout}`,
              ),
            )
          }
          closing = true
          // Tell clients the connection will not stay open, where the last response has not been sent yet
          for (const responses of inProgress.values()) {
            const last = [...responses].at(-1)
            if (last && !last.headersSent) last.shouldKeepAlive = false
          }
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

  // Only host[:port]: a name or bracketed IPv6 address and a port of 1–65535. Comparing with the
  // URL parser's output instead would reject valid spellings such as an explicit default port (:80)
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(host)
  if (!match) return undefined
  const port = match[2]
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) {
    return undefined
  }
  try {
    return new URL(`http://${host}${pathAndQuery}`)
  } catch {
    return undefined
  }
}

/**
 * Accepting only known host names defeats DNS rebinding (a page on another site reaching this server through
 * a name that resolves to it) and keeps a forged Host out of ctx.url
 */
function createHostCheck(
  allowedHosts: readonly string[] | true | undefined,
  hostname: string,
): (host: string) => boolean {
  if (allowedHosts === true) return () => true
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]'])
  const listening = canonicalIp(hostname)
  if (listening && listening !== '0.0.0.0' && listening !== '[::]') {
    allowed.add(listening)
  }
  for (const entry of allowedHosts ?? []) {
    const name = canonicalIp(entry) ?? normalizeHost(entry)
    if (!name || !/^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/.test(name)) {
      throw new TypeError(
        `mixer: allowedHosts takes host names without a port or wildcard: ${JSON.stringify(entry)}`,
      )
    }
    allowed.add(name)
  }
  return (host) => allowed.has(host) || host.endsWith('.localhost')
}

/**
 * The form URL gives an IP address (IPv6 in brackets), so that both spellings compare equal. A zone such as
 * `%eth0` is dropped: Node can listen on a scoped address, but URL rejects one and Host never carries it
 */
function canonicalIp(value: string): string | undefined {
  const bare = value.replace(/^\[(.*)\]$/, '$1').replace(/%.*$/, '')
  if (!isIP(bare)) return undefined
  return new URL(`http://${isIP(bare) === 6 ? `[${bare}]` : bare}`).hostname
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '')
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
