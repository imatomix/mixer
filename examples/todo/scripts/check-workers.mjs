// `node scripts/check-workers.mjs` after `pnpm build`: bundles src/worker.ts like Wrangler would, without
// Node.js compatibility, and runs the browser flow on workerd through Miniflare
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { flow } from './flow.mjs'

const bundle = await build({
  entryPoints: [new URL('../src/worker.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  conditions: ['workerd', 'worker', 'browser', 'import'],
  mainFields: ['module', 'main'],
  logLevel: 'silent',
})
const script = bundle.outputFiles[0].text
if (/\bnode:/.test(script)) throw new Error('The Worker bundle uses Node.js')

const mf = new Miniflare({
  modules: true,
  script,
  compatibilityDate: '2026-07-30',
  compatibilityFlags: ['no_nodejs_compat', 'no_nodejs_compat_v2'],
})
try {
  await flow((path, init) => mf.dispatchFetch(`http://localhost${path}`, init))
  console.log('example on workerd: ok')
} finally {
  await mf.dispose()
}
