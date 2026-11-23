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

export interface Server {
  readonly port: number
  /** Stops accepting connections and lets requests in progress finish */
  close(): Promise<void>
}

interface FetchApp {
  fetch: (request: Request) => Promise<Response>
  /** A mixer app's handle, which takes the peer's address; other fetch handlers are served through fetch */
  handle?: (
    request: Request,
    options: { remoteAddress?: string | undefined },
  ) => Promise<Response>
}

// Only what this adapter uses, so that mixer does not depend on Bun's type package
interface BunServer {
  readonly port: number
  requestIP(request: Request): { address: string } | null
  stop(closeActiveConnections?: boolean): Promise<void>
}
declare const Bun: {
  serve(options: {
    hostname: string
    port: number
    fetch(request: Request, server: BunServer): Promise<Response>
  }): BunServer
}

/**
 * Serves a mixer app with Bun.serve, with the same safe defaults as the Node.js adapter: it listens on this machine
 * only and answers 400 to host names it does not know (DNS rebinding), and the app gets the peer's address
 */
export async function serve(
  app: FetchApp,
  options: ServeOptions = {},
): Promise<Server> {
  const hostname = options.hostname ?? '127.0.0.1'
  const allowsHost = createHostCheck(options.allowedHosts, hostname)
  let warned = false

  const server = Bun.serve({
    hostname,
    port: options.port ?? 0,
    // Bun passes the server as a second argument; app.fetch would take it as env, so only the request goes on
    fetch: async (request, bunServer) => {
      const header = request.headers.get('host')?.toLowerCase()
      let host: string | undefined
      if (header && isHostHeader(header)) {
        try {
          host = normalizeHost(new URL(`http://${header}`).hostname)
        } catch {
          // A syntactically plausible Host can still contain an invalid IP address.
        }
      }
      if (!host || !allowsHost(host)) {
        if (host && !warned) {
          warned = true
          // The host name passed the format check, so it cannot inject anything into the log
          console.warn(
            `mixer: rejected a request for the host name "${host}". To accept it, pass serve(app, { allowedHosts: ['${host}'] })`,
          )
        }
        return new Response(null, { status: 400 })
      }
      return app.handle
        ? app.handle(request, {
            remoteAddress: bunServer.requestIP(request)?.address,
          })
        : app.fetch(request)
    },
  })

  return {
    port: server.port,
    close: () => server.stop(),
  }
}
