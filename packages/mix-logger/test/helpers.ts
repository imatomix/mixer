import { type Component, Mixer } from '@imatomix/mixer'

export type App = Mixer

export function app(...components: Component[]): App {
  return new Mixer().mix(...components)
}

/** Calls the app without starting a server */
export function call(
  target: Pick<App, 'fetch'> | { fetch(request: Request): Promise<Response> },
  path = '/',
  init?: RequestInit,
): Promise<Response> {
  return target.fetch(new Request(new URL(path, 'http://localhost'), init))
}
