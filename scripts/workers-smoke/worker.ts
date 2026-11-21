// The Worker that `pnpm verify:pack:workers` runs on workerd without Node.js compatibility.
// It is copied into the scratch consumer project and imports the packed packages as users would.

import { cors } from '@imatomix/mix-cors'
import { type LogEntry, logger } from '@imatomix/mix-logger'
import { createRouter } from '@imatomix/mix-router'
import { type SessionState, session } from '@imatomix/mix-session'
import { HttpError, Mixer } from '@imatomix/mixer'

type Env = { GREETING: string }

const { get, post } = createRouter<SessionState>()

// Set by a log write that finishes after the response, to prove that ctx.waitUntil reached workerd
let lastLoggedPath = ''

const writeLater = (entry: LogEntry) =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      lastLoggedPath = entry.path
      resolve()
    }, 50)
  })

const app = new Mixer<SessionState, Env>({ basePath: '/api' }).mix(
  cors({ origin: 'https://a.example' }),
  session(),
  logger({ write: writeLater }),
  get('/logged', () => lastLoggedPath),
  get('/hello/:name', (ctx, { name }) => ({
    hello: name,
    // mix-router types ctx.state but not ctx.env, so the binding type is stated here
    greeting: (ctx.env as Env).GREETING,
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
  get('/me', (ctx) => ({ user: ctx.state.session.get('user') ?? null })),
)

export default app satisfies ExportedHandler<Env>
