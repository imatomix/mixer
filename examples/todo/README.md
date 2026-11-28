# mixer todo example

English | [日本語](README.ja.md)

A small server-rendered todo app built with mixer and its modules: sign in, add, finish, and delete todos. It shows the recommended stack for an app that serves pages to browsers, and its tests check the modules together.

**Not for production as is.** Users, todos, and sessions are kept in memory and lost on restart, and the demo accounts keep passwords as plain text. Replace `src/data.ts` and pass a shared `sessionStore` before using it anywhere but your own machine.

```sh
pnpm --filter @imatomix/example-todo start      # Node.js, http://localhost:3000, sign in as demo / demo
pnpm --filter @imatomix/example-todo start:bun  # Bun
pnpm --filter @imatomix/example-todo test       # tests through app.fetch
pnpm --filter @imatomix/example-todo check:bun      # the browser flow on Bun, through @imatomix/mixer/bun
pnpm --filter @imatomix/example-todo check:workers  # the browser flow on workerd, without Node.js compatibility
pnpm --filter @imatomix/example-todo dev:web    # the React frontend at http://localhost:5173, with the API from `start`
pnpm --filter @imatomix/example-todo build:web  # build the frontend into web/dist
```

## What it shows

- One file per role: `src/app.ts` only puts the parts together; routes live in `src/routes/` per resource (sign-in, and the todos: the list at `GET /todos` and its actions, mounted with `group('/todos', ...)`; `/` redirects to the list), the app's state type and its route functions in `src/router.ts`, the sign-in check in `src/auth.ts`, and the pages in `src/pages.ts`
- A JSON API under `/api` for a frontend on the same origin: `POST /api/session` and `DELETE /api/session` to sign in and out, `GET /api/me`, and `GET`/`POST /api/todos` with `PATCH`/`DELETE /api/todos/:id`. Input is checked with Zod through `validateInput()`, an unknown API path is a JSON `404`, and errors answer JSON with the request ID
- A React frontend in `web/` (Vite, no router or state library) that uses the JSON API. `web/src/api.ts` calls it with relative `/api` URLs, so the session cookie goes with every request, and turns every failure into one `ApiError`, even a page from a proxy; a server failure is shown with its request ID. The hooks in `web/src/hooks/` load data, offer a retry when loading fails, and ignore answers that arrive too late; the components only draw. While developing, Vite passes `/api` to the app started with `start`. The app does not serve the built frontend yet; the server-rendered pages are still what `start` shows
- The order of components: `logger()`, `secureHeaders()` with a CSP, static files (before `session()`, so they stay cacheable), `csrf()`, `session()` (which keeps every signed-in page out of caches), the sign-in routes, one sign-in check, then the routes that need it
- Signing in with `session.regenerate()`, signing out with a POST that calls `session.destroy()`, and `303` redirects after every POST
- One sign-in check for every route after it, because components run in order. It also sends signed-out visitors of unknown paths to the login page
- Forms read with `ctx.form()`, which answers `415` to anything but a form
- One user can never reach another user's todos: lookups take the user's ID, and a todo that is missing or someone else's is the same `404`
- HTML built with a small `html` template tag (`src/html.ts`) that escapes every value
- Error pages from `onError` that show the request ID, which also appears in the logs and in `X-Request-Id`
- Entry points for Node.js (`src/node.ts`) and Bun (`src/bun.ts`), both through mixer's `serve()` with its safe defaults, and Cloudflare Workers (`src/worker.ts`). On Workers, serve `public/` with Static Assets, and use an external session store such as mix-session's Redis store
