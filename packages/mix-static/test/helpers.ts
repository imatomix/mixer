import { request } from 'node:http'
import { type Component, Mixer } from '@imatomix/mixer'
import { type Server, serve } from '@imatomix/mixer/node'
import { afterEach } from 'vitest'

export type App = Mixer

export function app(...components: Component[]): App {
  return new Mixer().mix(...components)
}

/** Calls the app without starting a server */
export function call(
  target: App,
  path = '/',
  init?: RequestInit,
): Promise<Response> {
  return target.fetch(new Request(new URL(path, 'http://localhost'), init))
}

const running: Server[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()))
})

/**
 * Sends the path as is through the Node adapter. Request and fetch normalize paths (`/../x` becomes `/x`),
 * so attack paths have to go over a real connection
 */
export async function raw(
  target: App,
  path: string,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  const server = await serve(target, { hostname: '127.0.0.1' })
  running.push(server)
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port: server.port, path },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}
