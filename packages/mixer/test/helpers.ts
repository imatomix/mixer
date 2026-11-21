import type { ExecutionContextLike } from '../src/index.js'

interface FetchApp {
  fetch: (
    request: Request,
    env?: never,
    executionContext?: ExecutionContextLike,
  ) => Promise<Response>
}

/** Calls the app without starting a server */
export function call(
  app: FetchApp,
  path = '/',
  init?: RequestInit,
): Promise<Response> {
  return app.fetch(new Request(new URL(path, 'http://localhost'), init))
}

/** A ReadableStream that records whether it was read or cancelled */
export function trackedStream(chunks: string[]) {
  const state = { pulled: false, cancelled: false }
  const encoder = new TextEncoder()
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled = true
      const chunk = chunks[index++]
      if (chunk === undefined) controller.close()
      else controller.enqueue(encoder.encode(chunk))
    },
    cancel() {
      state.cancelled = true
    },
  })
  return { stream, state }
}
