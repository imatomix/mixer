import type { ExecutionContextLike } from '@imatomix/mixer'

interface FetchApp {
  fetch: (
    request: Request,
    env?: never,
    executionContext?: ExecutionContextLike,
  ) => Promise<Response>
}

/**
 * Calls the app without starting a server. The URL is built by concatenation so that paths
 * starting with `//` stay paths instead of becoming a host
 */
export function call(
  app: FetchApp,
  path = '/',
  init?: RequestInit,
): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, init))
}
