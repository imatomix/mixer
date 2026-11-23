# mixer todo example

English | [日本語](README.ja.md)

A small server-rendered todo app built with mixer and its modules: sign in, add, finish, and delete todos. It shows the recommended stack for an app that serves pages to browsers, and its tests check the modules together.

**Not for production as is.** Users, todos, and sessions are kept in memory and lost on restart, and the demo accounts keep passwords as plain text. Replace `src/data.ts` and pass a shared `sessionStore` before using it anywhere but your own machine.

```sh
pnpm --filter @imatomix/example-todo start      # Node.js, http://localhost:3000, sign in as demo / demo
pnpm --filter @imatomix/example-todo start:bun  # Bun
pnpm --filter @imatomix/example-todo test       # tests through app.fetch
pnpm --filter @imatomix/example-todo check:bun      # the browser flow on Bun.serve
pnpm --filter @imatomix/example-todo check:workers  # the browser flow on workerd, without Node.js compatibility
```

## What it shows

- The order of components: `logger()`, `secureHeaders()` with a CSP, static files (before `session()`, so they stay cacheable), `csrf()`, `session()` (which keeps every signed-in page out of caches), the sign-in routes, one sign-in check, then the routes that need it
- Signing in with `session.regenerate()`, signing out with a POST that calls `session.destroy()`, and `303` redirects after every POST
- One sign-in check for every route after it, because components run in order. It also sends signed-out visitors of unknown paths to the login page
- Forms read with `ctx.form()`, which answers `415` to anything but a form
- One user can never reach another user's todos: lookups take the user's ID, and a todo that is missing or someone else's is the same `404`
- HTML built with a small `html` template tag (`src/html.ts`) that escapes every value
- Error pages from `onError` that show the request ID, which also appears in the logs and in `X-Request-Id`
- Entry points for Node.js (`src/node.ts`) and Bun (`src/bun.ts`), both through mixer's `serve()` with its safe defaults, and Cloudflare Workers (`src/worker.ts`). On Workers, serve `public/` with Static Assets, and use an external session store such as mix-session's Redis store
