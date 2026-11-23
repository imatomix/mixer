// `bun scripts/check-bun.ts` after `pnpm build`: runs the browser flow against the Bun adapter
import { serve } from '@imatomix/mixer/bun'
import { app } from '../src/bun.ts'
// @ts-expect-error a plain JavaScript module shared with the Workers check
import { flow } from './flow.mjs'

const server = await serve(app)
try {
  await flow((path: string, init: RequestInit) =>
    fetch(`http://localhost:${server.port}${path}`, init),
  )
  console.log('example on Bun: ok')
} finally {
  await server.close()
}
