// Runs the example on Bun: `bun src/bun.ts` after `pnpm build`, then open http://localhost:3000 and sign in as
// demo / demo. Everything is kept in memory and lost when the process stops.
import { fileURLToPath } from 'node:url'
import { serveStatic } from '@imatomix/mix-static'
import { createApp } from './app.ts'
import { demoUsers, MemoryTodos } from './data.ts'

interface BunServer {
  readonly port: number
  requestIP(request: Request): { address: string } | null
  stop(): Promise<void>
}
declare const Bun: {
  serve(options: {
    port: number
    fetch(request: Request, server: BunServer): Promise<Response>
  }): BunServer
}

export const app = createApp({
  users: demoUsers([{ id: 'demo', name: 'demo', password: 'demo' }]),
  todos: new MemoryTodos(),
  assets: serveStatic(fileURLToPath(new URL('../public', import.meta.url))),
})

export function start(port: number): BunServer {
  return Bun.serve({
    port,
    // Bun passes the server as a second argument, so call handle() rather than handing it app.fetch
    fetch: (request, server) =>
      app.handle(request, {
        remoteAddress: server.requestIP(request)?.address,
      }),
  })
}

if (import.meta.main) {
  const server = start(Number(process.env.PORT ?? 3000))
  console.log(`mixer todo: http://localhost:${server.port}`)
}
