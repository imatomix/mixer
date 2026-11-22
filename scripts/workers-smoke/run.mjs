// Runs worker.ts from the scratch consumer project on workerd (through Miniflare) without Node.js compatibility.
// From the 2026-08-04 compatibility date on, Node.js compatibility is enabled by default, so it is turned off
// explicitly; otherwise a node: import would slip through.
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

// The newest date the workerd bundled with miniflare supports. Update it deliberately, together with the READMEs
export const COMPATIBILITY_DATE = '2026-07-30'
const COMPATIBILITY_FLAGS = ['no_nodejs_compat', 'no_nodejs_compat_v2']

const BODY_LIMIT = 3 * 1024 * 1024

export async function verifyOnWorkers({ root, consumer, run }) {
  copyFileSync(
    join(root, 'scripts', 'workers-smoke', 'worker.ts'),
    join(consumer, 'worker.ts'),
  )
  writeFileSync(
    join(consumer, 'tsconfig.worker.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2024',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2024'],
        strict: true,
        noEmit: true,
        typeRoots: [join(root, 'node_modules', '@cloudflare')],
        types: ['workers-types'],
      },
      files: ['worker.ts'],
    }),
  )
  run(
    join(root, 'node_modules', '.bin', 'tsc'),
    ['-p', 'tsconfig.worker.json'],
    consumer,
  )
  console.log('Type check with Workers types: ok')

  // Node.js built-ins are not marked external: an import of one fails the bundle instead of reaching workerd
  const bundle = await build({
    entryPoints: [join(consumer, 'worker.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    conditions: ['workerd', 'worker', 'browser', 'import'],
    mainFields: ['module', 'main'],
    logLevel: 'silent',
  })
  const script = bundle.outputFiles[0].text
  // A Node.js global in a branch that never runs would not fail at load time, so look for one in the bundle
  for (const pattern of [/\bnode:/, /\bprocess\./, /\bBuffer\b/]) {
    if (pattern.test(script)) {
      throw new Error(`The Worker bundle uses Node.js (${pattern})`)
    }
  }

  const mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: COMPATIBILITY_DATE,
    compatibilityFlags: COMPATIBILITY_FLAGS,
    bindings: { GREETING: 'hi' },
  })
  try {
    await smoke((path, init) =>
      mf.dispatchFetch(`http://localhost${path}`, init),
    )
  } finally {
    await mf.dispose()
  }
  return `ok on workerd ${COMPATIBILITY_DATE} (no_nodejs_compat)`
}

async function smoke(fetch) {
  const expect = (label, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Workers smoke test failed: ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      )
    }
  }

  const hello = await fetch('/api/hello/mixer')
  expect('route and env', await hello.json(), {
    hello: 'mixer',
    greeting: 'hi',
  })
  expect('nosniff', hello.headers.get('x-content-type-options'), 'nosniff')

  const outside = await fetch('/hello/mixer')
  await outside.text()
  expect('outside basePath', outside.status, 404)

  const echo = await fetch('/api/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
  })
  expect('JSON body', await echo.json(), { a: 1 })

  // Written out by hand: Miniflare's own fetch does not recognize Node's FormData
  const field = (value) =>
    `--b\r\nContent-Disposition: form-data; name="a"\r\n\r\n${value}\r\n`
  const multipart = await fetch('/api/echo', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=b' },
    body: `${field('1')}${field('2')}--b--\r\n`,
  })
  expect('multipart body', await multipart.json(), { a: ['1', '2'] })

  const tooLarge = await fetch('/api/echo', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'x'.repeat(BODY_LIMIT + 1),
  })
  await tooLarge.text()
  expect('body limit', tooLarge.status, 413)

  expect('stream', await (await fetch('/api/stream')).text(), 'mixer')

  const forbidden = await fetch('/api/forbidden')
  expect(
    'HttpError',
    [forbidden.status, await forbidden.json()],
    [403, { error: 'Forbidden' }],
  )

  const preflight = await fetch('/api/hello/mixer', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://a.example',
      'access-control-request-method': 'PUT',
    },
  })
  await preflight.text()
  expect(
    'CORS preflight',
    [preflight.status, preflight.headers.get('access-control-allow-origin')],
    [204, 'https://a.example'],
  )

  const login = await fetch('/api/login', { method: 'POST' })
  await login.text()
  const cookies = login.headers.getSetCookie()
  expect('two Set-Cookie headers', cookies.length, 2)
  const sid = cookies.find((cookie) => cookie.startsWith('sid='))?.split(';')[0]
  const me = await fetch('/api/me', { headers: { cookie: sid ?? '' } })
  expect('session', await me.json(), { user: 'mixer' })

  // The log write finishes 50 ms after the response; only ctx.waitUntil keeps it running on workerd
  await (await fetch('/api/hello/later')).text()
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(
    'waitUntil',
    await (await fetch('/api/logged')).text(),
    '/api/hello/later',
  )
}
