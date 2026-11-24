import { csrf } from '@imatomix/mix-csrf'
import { type LoggerOptions, logger } from '@imatomix/mix-logger'
import { secureHeaders } from '@imatomix/mix-secure-headers'
import { type SessionStore, session } from '@imatomix/mix-session'
import { type Component, HttpError, Mixer } from '@imatomix/mixer'
import { requireSignIn } from './auth.ts'
import type { TodoRepository, Users } from './data.ts'
import { seeOther } from './http.ts'
import { errorPage } from './pages.ts'
import { type AppState, get, group, type SessionData } from './router.ts'
import { authRoutes } from './routes/auth.ts'
import { todoRoutes } from './routes/todos.ts'

export type { AppState } from './router.ts'

export interface AppOptions {
  users: Users
  todos: TodoRepository
  /** Defaults to mix-session's MemoryStore, which only works in one process */
  sessionStore?: SessionStore
  /** Serves /style.css. Node.js and Bun pass mix-static; Workers serve it as a static asset instead */
  assets?: Component
  log?: LoggerOptions['write']
}

export function createApp(options: AppOptions): Mixer<AppState> {
  const app = new Mixer<AppState>({
    onError: (error, ctx) => {
      const message =
        error instanceof HttpError && error.expose
          ? error.message
          : 'Something went wrong'
      return errorPage(ctx.status, message, ctx.state.log?.requestId)
    },
  })

  return app.mix(
    logger(options.log ? { write: options.log } : {}),
    secureHeaders({
      csp: {
        'default-src': ["'self'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
      },
    }),
    ...(options.assets ? [options.assets] : []),
    csrf(),
    // mix-session marks every response with a session private, no-store, so signed-in pages are never cached
    session<SessionData>(
      options.sessionStore ? { store: options.sessionStore } : {},
    ),

    ...authRoutes(options.users),

    // Components run in order, so everything below needs a signed-in user
    requireSignIn,
    get('/', () => seeOther('/todos')),
    group('/todos', todoRoutes(options.todos)),
  )
}
