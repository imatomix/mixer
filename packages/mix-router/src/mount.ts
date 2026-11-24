import { type ExecutionContextLike, Mixer, type State } from '@imatomix/mixer'
import { methodRecord } from './method-not-allowed.js'
import { prefixScope } from './prefix.js'
import { createRoute, type Route } from './route.js'

/** An app that answers a Web Request: an object with fetch, such as a Hono app, or a fetch function */
export type FetchHandler =
  | {
      fetch(
        request: Request,
        env: unknown,
        executionContext: ExecutionContextLike,
      ): Response | Promise<Response>
    }
  | ((
      request: Request,
      env: unknown,
      executionContext: ExecutionContextLike,
    ) => Response | Promise<Response>)

/**
 * Hands every request under the prefix, whatever its method, to a whole app: another mixer app (give it the full
 * mount path as basePath) or any fetch handler. The URL is passed as it is, with ctx.env, waitUntil, and the
 * client's address, which a plain call from a route would lose
 */
export function mount<S extends State = State, E = unknown>(
  prefix: string,
  // biome-ignore lint/suspicious/noExplicitAny: a mounted mixer app has its own State and Env types
  app: Mixer<any, any> | FetchHandler,
): Route<S, E> {
  const scope = prefixScope('mount', prefix)

  return createRoute(async (ctx, outerPrefix) => {
    if (scope.under(ctx, outerPrefix) === undefined) return undefined
    methodRecord(ctx).taken = true
    if (ctx.request.bodyUsed) {
      throw new Error(
        'mix-router: mount() got a request whose body was already read; read the body only inside the mounted app',
      )
    }
    const executionContext: ExecutionContextLike = {
      waitUntil: (promise) => ctx.waitUntil(promise),
    }
    if (app instanceof Mixer) {
      return app.handle(ctx.request, {
        env: ctx.env,
        executionContext,
        // The peer, not ctx.ip, so the mounted app applies its own trustedProxies; ctx.ip only when a platform
        // resolved the client without a peer address
        remoteAddress: ctx.remoteAddress,
        clientIp: ctx.remoteAddress === undefined ? ctx.ip : undefined,
      })
    }
    return typeof app === 'function'
      ? app(ctx.request, ctx.env, executionContext)
      : app.fetch(ctx.request, ctx.env, executionContext)
  })
}
