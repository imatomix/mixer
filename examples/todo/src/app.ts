import { csrf } from '@imatomix/mix-csrf'
import {
  type LoggerOptions,
  type LoggerState,
  logger,
} from '@imatomix/mix-logger'
import { createRouter } from '@imatomix/mix-router'
import { secureHeaders } from '@imatomix/mix-secure-headers'
import {
  type SessionState,
  type SessionStore,
  session,
} from '@imatomix/mix-session'
import { type Component, HttpError, Mixer, redirect } from '@imatomix/mixer'
import type { Todo, TodoRepository, Users } from './data.ts'
import { type Html, html, htmlResponse } from './html.ts'

type SessionData = { userId: string; userName: string }
export type AppState = LoggerState & SessionState<SessionData>

export interface AppOptions {
  users: Users
  todos: TodoRepository
  /** Defaults to mix-session's MemoryStore, which only works in one process */
  sessionStore?: SessionStore
  /** Serves /style.css. Node.js and Bun pass mix-static; Workers serve it as a static asset instead */
  assets?: Component
  log?: LoggerOptions['write']
}

const TITLE_LENGTH = 200

const { get, post } = createRouter<AppState>()

export function createApp(options: AppOptions): Mixer<AppState> {
  const { users, todos } = options

  const app = new Mixer<AppState>({
    onError: (error, ctx) => {
      const status = ctx.status
      const message =
        error instanceof HttpError && error.expose
          ? error.message
          : 'Something went wrong'
      return errorPage(status, message, ctx.state.log?.requestId)
    },
  })

  app.mix(
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

    get('/login', () => htmlResponse(loginPage())),

    post('/login', async (ctx) => {
      const form = await ctx.form()
      const user = await users.authenticate(
        field(form, 'name'),
        field(form, 'password'),
      )
      if (!user) {
        return htmlResponse(loginPage('Wrong name or password'), 401)
      }
      ctx.state.session.regenerate()
      ctx.state.session.set('userId', user.id)
      ctx.state.session.set('userName', user.name)
      ctx.state.log.info('signed in', { userId: user.id })
      return seeOther('/')
    }),

    post('/logout', (ctx) => {
      ctx.state.session.destroy()
      return seeOther('/login')
    }),

    // Components run in order, so everything below needs a signed-in user
    (ctx) => (signedInUser(ctx) ? undefined : seeOther('/login')),

    get('/', async (ctx) => {
      const user = currentUser(ctx)
      return htmlResponse(listPage(user.name, await todos.list(user.id)))
    }),

    post('/todos', async (ctx) => {
      const user = currentUser(ctx)
      const title = field(await ctx.form(), 'title').trim()
      if (title.length === 0 || title.length > TITLE_LENGTH) {
        const list = listPage(
          user.name,
          await todos.list(user.id),
          `A title is between 1 and ${TITLE_LENGTH} characters`,
        )
        return htmlResponse(list, 422)
      }
      const todo = await todos.add(user.id, title)
      ctx.state.log.info('todo added', { todoId: todo.id })
      return seeOther('/')
    }),

    post('/todos/:id/toggle', async (ctx, { id }) => {
      const todo = await ownTodo(currentUser(ctx).id, id)
      await todos.update({ ...todo, done: !todo.done })
      return seeOther('/')
    }),

    post('/todos/:id/delete', async (ctx, { id }) => {
      await todos.remove(await ownTodo(currentUser(ctx).id, id))
      return seeOther('/')
    }),
  )

  /** 404 whether the todo does not exist or belongs to someone else, so IDs reveal nothing */
  async function ownTodo(userId: string, id: string): Promise<Todo> {
    const todo = await todos.find(userId, id)
    if (!todo) throw new HttpError(404)
    return todo
  }

  return app
}

/** After a POST, send the browser to a page with GET, so reloading does not send the form again */
function seeOther(path: string): Response {
  return redirect(path, { status: 303 })
}

/** The signed-in user, for routes after the sign-in check */
function currentUser(ctx: { state: AppState }): { id: string; name: string } {
  const user = signedInUser(ctx)
  if (!user) throw new HttpError(401)
  return user
}

function signedInUser(ctx: {
  state: AppState
}): { id: string; name: string } | undefined {
  const id = ctx.state.session.get('userId')
  const name = ctx.state.session.get('userName')
  return id && name ? { id, name } : undefined
}

/** One text field from a form; a missing field or a file is a malformed request */
function field(form: FormData, name: string): string {
  const value = form.get(name)
  if (typeof value !== 'string') {
    throw new HttpError(400, `The form field "${name}" is missing`)
  }
  return value
}

function layout(title: string, body: Html, userName?: string): Html {
  return html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · mixer todo</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
<h1>mixer todo</h1>
${
  userName &&
  html`<form method="post" action="/logout"><span>${userName}</span> <button>Sign out</button></form>`
}
</header>
<main>
${body}
</main>
</body>
</html>`
}

function loginPage(error?: string): Html {
  return layout(
    'Sign in',
    html`<h2>Sign in</h2>
${error && html`<p class="error">${error}</p>`}
<form method="post" action="/login">
<label>Name <input name="name" autocomplete="username" required></label>
<label>Password <input name="password" type="password" autocomplete="current-password" required></label>
<button>Sign in</button>
</form>`,
  )
}

function listPage(userName: string, list: Todo[], error?: string): Html {
  return layout(
    'Todos',
    html`<h2>Todos</h2>
${error && html`<p class="error">${error}</p>`}
<form method="post" action="/todos">
<input name="title" maxlength="${TITLE_LENGTH}" required aria-label="New todo">
<button>Add</button>
</form>
<ul>
${list.map(
  (todo) => html`<li${todo.done ? html` class="done"` : ''}>
<form method="post" action="/todos/${todo.id}/toggle"><button>${todo.done ? 'Undo' : 'Done'}</button></form>
<span>${todo.title}</span>
<form method="post" action="/todos/${todo.id}/delete"><button>Delete</button></form>
</li>`,
)}
</ul>`,
    userName,
  )
}

function errorPage(
  status: number,
  message: string,
  requestId: string | undefined,
): Response {
  const page = layout(
    `Error ${status}`,
    html`<h2>${status}</h2>
<p>${message}</p>
${requestId && html`<p>If you contact us, mention this ID: <code>${requestId}</code></p>`}`,
  )
  return htmlResponse(page, status)
}
