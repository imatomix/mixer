// `bun scripts/check-bun.ts` after `pnpm build`: runs the browser flow against Bun.serve
import { start } from '../src/bun.ts'
// @ts-expect-error a plain JavaScript module shared with the Workers check
import { flow } from './flow.mjs'

const server = start(0)
try {
  await flow((path: string, init: RequestInit) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, init),
  )
  console.log('example on Bun: ok')
} finally {
  await server.stop()
}
