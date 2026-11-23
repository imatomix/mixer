// Runs the example on Bun: `pnpm --filter @imatomix/example-todo start:bun`, then open http://localhost:3000 and
// sign in as demo / demo. Everything is kept in memory and lost when the process stops.
import { fileURLToPath } from 'node:url'
import { serveStatic } from '@imatomix/mix-static'
import { serve } from '@imatomix/mixer/bun'
import { createApp } from './app.ts'
import { demoUsers, MemoryTodos } from './data.ts'

export const app = createApp({
  users: demoUsers([{ id: 'demo', name: 'demo', password: 'demo' }]),
  todos: new MemoryTodos(),
  assets: serveStatic(fileURLToPath(new URL('../public', import.meta.url))),
})

if (import.meta.main) {
  const server = await serve(app, { port: Number(process.env.PORT ?? 3000) })
  console.log(`mixer todo: http://localhost:${server.port}`)
}
