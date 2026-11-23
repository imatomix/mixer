// Runs the example on Node.js: `pnpm --filter @imatomix/example-todo start`, then open http://localhost:3000
// and sign in as demo / demo. Everything is kept in memory and lost when the process stops.
import { fileURLToPath } from 'node:url'
import { serveStatic } from '@imatomix/mix-static'
import { serve } from '@imatomix/mixer/node'
import { createApp } from './app.ts'
import { demoUsers, MemoryTodos } from './data.ts'

const app = createApp({
  users: demoUsers([{ id: 'demo', name: 'demo', password: 'demo' }]),
  todos: new MemoryTodos(),
  assets: serveStatic(fileURLToPath(new URL('../public', import.meta.url))),
})

const server = await serve(app, { port: Number(process.env.PORT ?? 3000) })
console.log(`mixer todo: http://localhost:${server.port}`)
