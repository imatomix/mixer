// The Worker that `pnpm verify:pack:workers` runs on workerd without Node.js compatibility.
// It is copied into the scratch consumer project and imports the packed packages as users would.

import { cors } from '@imatomix/mix-cors'
import { csrf } from '@imatomix/mix-csrf'
import { type LogEvent, logger } from '@imatomix/mix-logger'
import { createRouter } from '@imatomix/mix-router'
import { secureHeaders } from '@imatomix/mix-secure-headers'
import { type SessionState, session } from '@imatomix/mix-session'
import { sessionKey } from '@imatomix/mix-session/redis'
import { HttpError, Mixer } from '@imatomix/mixer'

type Env = { GREETING: string }

const { get, post } = createRouter<SessionState, Env>()

// Set by a log write that finishes after the response, to prove that ctx.waitUntil reached workerd
let lastLoggedPath = ''

const writeLater = (event: LogEvent) =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      if (event.kind === 'access') lastLoggedPath = event.path
      resolve()
    }, 50)
  })

const app = new Mixer<SessionState, Env>({ basePath: '/api' }).mix(
  secureHeaders(),
  cors({ origin: 'https://a.example' }),
  csrf(),
  session(),
  logger({ write: writeLater }),
  get('/logged', () => lastLoggedPath),
  get('/ip', (ctx) => ({ ip: ctx.ip ?? null })),
  get('/hello/:name', (ctx, { name }) => ({
    hello: name,
    greeting: ctx.env.GREETING,
  })),
  post('/echo', (ctx) => ctx.body()),
  get('/stream', () => {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('mix'))
        controller.enqueue(encoder.encode('er'))
        controller.close()
      },
    })
  }),
  get('/forbidden', () => {
    throw new HttpError(403, 'Forbidden')
  }),
  post('/login', (ctx) => {
    ctx.state.session.set('user', 'mixer')
    ctx.cookies.set('theme', 'dark')
    return 'ok'
  }),
  get('/key', () => sessionKey('abc')),
  get('/me', (ctx) => ({ user: ctx.state.session.get('user') ?? null })),
)

// CF-Connecting-IP is set by Cloudflare; mixer cannot tell that from a forged header, so the Worker passes it
export default {
  fetch: (request, env, executionContext) =>
    app.handle(request, {
      env,
      executionContext,
      clientIp: request.headers.get('cf-connecting-ip') ?? undefined,
    }),
} satisfies ExportedHandler<Env>
