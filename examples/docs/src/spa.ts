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
