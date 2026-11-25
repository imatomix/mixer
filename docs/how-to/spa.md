# Single-page apps

English | [日本語](spa.ja.md)

Serve a React (or Vue, Svelte, ...) app built as files and its API from one mixer app. On one origin, cookies and CSRF protection work as they are, and no CORS is needed.

| URL | Answered by |
| --- | --- |
| `/api/...` | the API routes, with a JSON `404` for an unknown path |
| `/assets/app.3f9a1c.js`, `/logo.svg`, ... | the build output, served by mix-static |
| `/`, `/todos/3`, any other page | `index.html`, so that the app's own router shows the page |

```ts
// examples/docs/src/spa.ts
import { join } from 'node:path'
import { csrf } from '@imatomix/mix-csrf'
import { get, group } from '@imatomix/mix-router'
import { secureHeaders } from '@imatomix/mix-secure-headers'
import { serveFile, serveStatic } from '@imatomix/mix-static'
import { type Component, HttpError, Mixer } from '@imatomix/mixer'

const apiRoutes = [get('/hello', () => ({ message: 'Hello from mixer' }))]

/** dist is the build output of the React app, such as Vite's dist/ */
export function createApp(dist: string) {
  const indexPage = serveFile(join(dist, 'index.html'))

  // A page of the React app: a GET from a browser that no API route or file answered
  const reactPages: Component = (ctx, next) => {
    const accept = ctx.request.headers.get('accept') ?? ''
    if (ctx.method === 'GET' && accept.includes('text/html')) {
      return indexPage(ctx, next)
    }
  }

  return new Mixer().mix(
    secureHeaders({ csp: { 'default-src': ["'self'"] } }),
    csrf(),
    group('/api', apiRoutes, () => {
      throw new HttpError(404)
    }),
    // Fingerprinted names change with the content, so those files can be cached for a year
    serveStatic(join(dist, 'assets'), {
      prefix: '/assets',
      maxAge: 31_536_000,
      immutable: true,
    }),
    serveStatic(dist),
    reactPages,
  )
}
```

- **The order is what makes it work.** The API comes first and ends with a `404`, so a mistyped API path is an error the app can read, never the page. Files come next. The page comes last and only for a `GET` from a browser (`Accept: text/html`), so a missing script answers `404` instead of HTML the browser would try to run
- Files under `assets/` have the content's hash in their names, so they are cached for a year with `immutable`; `index.html` goes out with `max-age=0` and an ETag, so the browser checks for a new build on every visit and gets a `304` when nothing changed
- Call the API from the app with relative URLs such as `fetch('/api/hello')`. The browser sends the session cookie and `Sec-Fetch-Site: same-origin`, which `csrf()` lets through
- `default-src 'self'` in the CSP fits a built app, whose scripts and styles are files of the same origin. Add sources only for what the app loads from elsewhere

## While developing

Run mixer and the frontend's dev server side by side, and let the dev server pass API requests to mixer. With Vite:

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:3000' } },
})
```

## A frontend on another origin

When the frontend is served elsewhere (a CDN or a hosting service) and mixer serves only the API, the origins differ: add [mix-cors](../../packages/mix-cors) with the frontend's origin. With cookies, also set `credentials: true` in mix-cors, call `fetch(url, { credentials: 'include' })` in the frontend, and list the frontend's origin in `csrf({ trustedOrigins })`. If the frontend is on another site rather than another subdomain, browsers send the session cookie only with `SameSite=None` (mix-session's `cookie: { sameSite: 'None' }`). One origin, as above, avoids all of that.

## On Cloudflare Workers

Serve the build output with Workers Static Assets instead of mix-static: set `not_found_handling = "single-page-application"` so pages get `index.html`, and `run_worker_first = ["/api/*"]` so API requests reach mixer first. See Cloudflare's [single-page application](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) guide.

The code and its tests are in [examples/docs](../../examples/docs). See also: [Running your app](runtimes.md), [mix-static](../../packages/mix-static), [mix-csrf](../../packages/mix-csrf).
