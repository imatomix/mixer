// The example as a Cloudflare Worker. Serve public/ with Workers Static Assets; those requests never reach the
// Worker, so they get no logs or headers from it. MemoryStore and MemoryTodos live in one isolate only, so a real
// deployment needs an external session store (such as mix-session's Redis store or a Durable Object) and storage.
import { createApp } from './app.ts'
import { demoUsers, MemoryTodos } from './data.ts'

const app = createApp({
  users: demoUsers([{ id: 'demo', name: 'demo', password: 'demo' }]),
  todos: new MemoryTodos(),
})

export default {
  fetch: (
    request: Request,
    env: unknown,
    executionContext: { waitUntil(promise: Promise<unknown>): void },
  ) =>
    app.handle(request, {
      env,
      executionContext,
      clientIp: request.headers.get('cf-connecting-ip') ?? undefined,
    }),
}
