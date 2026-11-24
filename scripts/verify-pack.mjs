// Installs the published artifacts (npm pack tarballs) the way users would, and checks their types and runtime imports.
// Inside the monorepo, packages resolve each other from src through the @imatomix/source condition, so tests cannot catch problems in dist.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verifyOnWorkers } from './workers-smoke/run.mjs'

const root = resolve(import.meta.dirname, '..')

// The packages are installed and type-checked once; only the final smoke test runs on the chosen runtime.
const runtimeArg = process.argv.find((arg) => arg.startsWith('--runtime='))
const runtime = runtimeArg ? runtimeArg.slice('--runtime='.length) : 'node'
if (runtime !== 'node' && runtime !== 'bun' && runtime !== 'workers') {
  throw new Error(
    `Unknown runtime: ${runtime} (expected node, bun, or workers)`,
  )
}
// Running through pnpm run passes pnpm's npm_config_* variables, which make npm print warnings, so drop them
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('npm_config_')),
)
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
    .toString()
    .trim()

const packages = readdirSync(join(root, 'packages'))
  .map((dir) => {
    const path = join(root, 'packages', dir)
    return {
      path,
      manifest: JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')),
    }
  })
  // Only packages that publish a dist build
  .filter(({ manifest }) => manifest.files?.includes('dist'))

const work = mkdtempSync(join(tmpdir(), 'mixer-verify-pack-'))
console.log(`Working directory: ${work}`)

const dependencies = {}
for (const { path, manifest } of packages) {
  run('pnpm', ['run', 'build'], path)
  const tarball = run('pnpm', ['pack', '--pack-destination', work], path)
    .split('\n')
    .at(-1)
  const contents = run('tar', ['-tzf', tarball], work).split('\n')
  const unexpected = contents.filter((file) =>
    /^package\/(src|test)\//.test(file),
  )
  if (unexpected.length > 0) {
    throw new Error(
      `${manifest.name}: the published files include unexpected files: ${unexpected.join(', ')}`,
    )
  }
  dependencies[manifest.name] = `file:${tarball}`
  console.log(`packed ${manifest.name}`)
}

const consumer = join(work, 'consumer')
run('mkdir', ['-p', consumer], work)
writeFileSync(
  join(consumer, 'package.json'),
  JSON.stringify(
    { name: 'consumer', private: true, type: 'module', dependencies },
    null,
    2,
  ),
)
run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], consumer)

const typesRoot = join(root, 'packages', 'mixer', 'node_modules', '@types')
writeFileSync(
  join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2024',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      // Compile the type-checked smoke.ts to JS and run it as is
      outDir: 'out',
      typeRoots: [typesRoot],
      types: ['node'],
    },
    include: ['*.ts'],
  }),
)

const imports = Object.keys(dependencies)
  .map((name, i) => `import * as pkg${i} from '${name}'`)
  .join('\n')
const checks = Object.keys(dependencies)
  .map(
    (name, i) =>
      `if (Object.keys(pkg${i}).length === 0) throw new Error('${name} exports nothing')`,
  )
  .join('\n')

const smoke = `${imports}
${checks}
import { request as httpRequest } from 'node:http'
import { serve as serveOnNode } from '@imatomix/mixer/node'
import { serve as serveOnBun } from '@imatomix/mixer/bun'

type FetchApp = {
  fetch: (request: Request) => Promise<Response>
  handle: (request: Request, options: { remoteAddress?: string | undefined }) => Promise<Response>
}

// Each runtime through its own adapter, the way users would serve the app
function listen(app: FetchApp): Promise<{ port: number; close(): Promise<void> }> {
  return 'Bun' in globalThis ? serveOnBun(app) : serveOnNode(app)
}
// Exercise the production package on a real server, including Bun's development error path.
for (const fail of [
  () => { throw new Error('adapter-test-secret') },
  () => Promise.reject(new Error('adapter-test-secret')),
]) {
  const server = await ('Bun' in globalThis ? serveOnBun : serveOnNode)({ fetch: fail })
  try {
    const response = await fetch(\`http://127.0.0.1:\${server.port}/\`)
    const body = await response.text()
    if (response.status !== 500 || body !== '') {
      throw new Error('Adapter failures must return an empty 500')
    }
  } finally {
    await server.close()
  }
}
${
  dependencies['@imatomix/mix-router']
    ? `
import { Mixer } from '@imatomix/mixer'
import { get } from '@imatomix/mix-router'

const app = new Mixer().mix(
  get('/hello/:name', (ctx, { name }) => ({
    hello: name,
    host: ctx.url.hostname,
    envIsEmpty: ctx.env === undefined,
    ip: ctx.ip,
  })),
)
const server = await listen(app)
const res = await fetch(\`http://127.0.0.1:\${server.port}/hello/mixer\`)
const body = await res.json()
// Fetch may replace Host; use HTTP directly to put the forged header on the wire.
const sendHostProbe = (path: string, host: string) => new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
  const request = httpRequest({
    hostname: '127.0.0.1', port: server.port, path,
    headers: { host },
  }, (response) => {
    let body = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { body += chunk })
    response.on('end', () => resolve({ status: response.statusCode, body }))
    response.on('error', reject)
  })
  request.on('error', reject)
  request.end()
})
const forgedStatus = await sendHostProbe('/hello/mixer', 'evil.example')
const absoluteStatus = await sendHostProbe('http://evil.example/hello/mixer', 'localhost')
await server.close()
if (forgedStatus.status !== 400) throw new Error('The adapter accepted a forged Host')
// Runtimes may normalize absolute-form targets; any forwarded URL must use the checked Host.
if (absoluteStatus.status !== 400 && (
  absoluteStatus.status !== 200 || JSON.parse(absoluteStatus.body).host !== 'localhost'
)) {
  throw new Error('The adapter forwarded a mismatched absolute-form authority')
}
// Bun passes its server as fetch's second argument; it must not end up in ctx.env
if (body.hello !== 'mixer' || body.envIsEmpty !== true || body.ip !== '127.0.0.1') {
  throw new Error(\`mixer + mix-router smoke test failed: \${JSON.stringify(body)}\`)
}
`
    : ''
}
${
  dependencies['@imatomix/mix-session']
    ? `
import { Mixer as SessionMixer } from '@imatomix/mixer'
import { MemoryStore, session, type SessionState } from '@imatomix/mix-session'
import { checkSessionStore } from '@imatomix/mix-session/testing'

await checkSessionStore(() => new MemoryStore(), { expiry: false })
import { redisStore, sessionKey } from '@imatomix/mix-session/redis'

// A stand-in for a Redis client (no server here), to check that the /redis entry point loads and works
const fakeRedis = new Map<string, string>()
await checkSessionStore(
  () =>
    redisStore({
      send: async ([command, key = '', value = '', , , xx]) => {
        if (command === 'GET') return fakeRedis.get(key) ?? null
        if (command === 'DEL') return fakeRedis.delete(key) ? 1 : 0
        if (xx === 'XX' && !fakeRedis.has(key)) return null
        fakeRedis.set(key, value)
        return 'OK'
      },
    }),
  { expiry: false },
)
if (!(await sessionKey('id')).startsWith('mix-session:')) throw new Error('sessionKey failed')

const sessionApp = new SessionMixer<SessionState>().mix(session(), (ctx) => {
  const current = ctx.state.session
  if (ctx.path === '/login') {
    current.set('user', 'mixer')
    // A second cookie checks that several Set-Cookie headers survive on this runtime
    ctx.cookies.set('theme', 'dark')
    return 'ok'
  }
  return { user: current.get('user') }
})
const sessionServer = await listen(sessionApp)
const base = \`http://127.0.0.1:\${sessionServer.port}\`
const login = await fetch(\`\${base}/login\`)
const setCookies = login.headers.getSetCookie()
const sid = setCookies.find((cookie) => cookie.startsWith('__Host-sid='))?.split(';')[0]
const me = await (await fetch(\`\${base}/me\`, { headers: { cookie: sid ?? '' } })).json()
await sessionServer.close()
if (me.user !== 'mixer' || setCookies.length !== 2) {
  throw new Error('mixer + mix-session smoke test failed')
}
`
    : ''
}
${
  dependencies['@imatomix/mix-static']
    ? `
import { mkdtempSync as makeTempDir, symlinkSync, writeFileSync as writeTempFile } from 'node:fs'
import { brotliCompressSync } from 'node:zlib'
import { tmpdir as osTmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { Mixer as StaticMixer } from '@imatomix/mixer'
import { serveStatic } from '@imatomix/mix-static'

const publicDir = makeTempDir(joinPath(osTmpdir(), 'mixer-smoke-static-'))
writeTempFile(joinPath(publicDir, 'hello.txt'), 'hello static')
// A real Brotli file, decoded by the runtime's fetch, to check precompressed files end to end
writeTempFile(joinPath(publicDir, 'compressed.txt'), 'compressed static')
writeTempFile(joinPath(publicDir, 'compressed.txt.br'), brotliCompressSync('compressed static'))
// A symbolic link inside the public directory that points outside it must never be served
const outsideDir = makeTempDir(joinPath(osTmpdir(), 'mixer-smoke-outside-'))
writeTempFile(joinPath(outsideDir, 'secret.txt'), 'secret')
symlinkSync(joinPath(outsideDir, 'secret.txt'), joinPath(publicDir, 'link.txt'))
const staticApp = new StaticMixer().mix(serveStatic(publicDir, { precompressed: true }))
const staticServer = await listen(staticApp)
const staticBase = \`http://127.0.0.1:\${staticServer.port}\`
const file = await fetch(\`\${staticBase}/hello.txt\`)
const fileText = await file.text()
const etag = file.headers.get('etag') ?? ''
const headResponse = await fetch(\`\${staticBase}/hello.txt\`, { method: 'HEAD' })
await headResponse.text()
const notModified = await fetch(\`\${staticBase}/hello.txt\`, { headers: { 'if-none-match': etag } })
await notModified.text()
const brotli = await fetch(\`\${staticBase}/compressed.txt\`, { headers: { 'accept-encoding': 'br' } })
const brotliText = await brotli.text()
const part = await fetch(\`\${staticBase}/hello.txt\`, { headers: { range: 'bytes=6-' } })
const partText = await part.text()
const escaped = await fetch(\`\${staticBase}/link.txt\`)
const escapedText = await escaped.text()
await staticServer.close()
if (
  fileText !== 'hello static' ||
  file.headers.get('content-type') !== 'text/plain; charset=utf-8' ||
  headResponse.status !== 200 ||
  part.status !== 206 ||
  brotli.headers.get('content-encoding') !== 'br' ||
  brotliText !== 'compressed static' ||
  partText !== 'static' ||
  headResponse.headers.get('content-length') !== '12' ||
  notModified.status !== 304 ||
  escaped.status !== 404 ||
  escapedText.includes('secret')
) {
  throw new Error('mixer + mix-static smoke test failed')
}
`
    : ''
}
${
  dependencies['@imatomix/mix-cors']
    ? `
import { Mixer as CorsMixer } from '@imatomix/mixer'
import { cors } from '@imatomix/mix-cors'

const corsApp = new CorsMixer().mix(cors({ origin: '*' }), () => 'cors ok')
const corsServer = await listen(corsApp)
const corsBase = \`http://127.0.0.1:\${corsServer.port}\`
const simple = await fetch(corsBase, { headers: { origin: 'https://a.example' } })
await simple.text()
const preflight = await fetch(corsBase, {
  method: 'OPTIONS',
  headers: { origin: 'https://a.example', 'access-control-request-method': 'PUT' },
})
await preflight.text()
await corsServer.close()
if (simple.headers.get('access-control-allow-origin') !== '*' || preflight.status !== 204) {
  throw new Error('mixer + mix-cors smoke test failed')
}
`
    : ''
}
${
  dependencies['@imatomix/mix-csrf']
    ? `
import { Mixer as CsrfMixer } from '@imatomix/mixer'
import { csrf } from '@imatomix/mix-csrf'

const csrfApp = new CsrfMixer().mix(csrf(), () => 'csrf ok')
const csrfServer = await listen(csrfApp)
const csrfBase = \`http://127.0.0.1:\${csrfServer.port}\`
const sameOrigin = await fetch(csrfBase, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } })
const sameOriginText = await sameOrigin.text()
const crossSite = await fetch(csrfBase, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })
await crossSite.text()
await csrfServer.close()
if (sameOriginText !== 'csrf ok' || crossSite.status !== 403) {
  throw new Error('mixer + mix-csrf smoke test failed')
}
`
    : ''
}
${
  dependencies['@imatomix/mix-secure-headers']
    ? `
import { Mixer as HeadersMixer } from '@imatomix/mixer'
import { secureHeaders } from '@imatomix/mix-secure-headers'

const headersApp = new HeadersMixer().mix(secureHeaders({ hsts: true }))
const headersServer = await listen(headersApp)
const missing = await fetch(\`http://127.0.0.1:\${headersServer.port}/missing\`)
await missing.text()
await headersServer.close()
if (
  missing.status !== 404 ||
  missing.headers.get('x-frame-options') !== 'DENY' ||
  missing.headers.get('strict-transport-security') !== 'max-age=31536000'
) {
  throw new Error('mixer + mix-secure-headers smoke test failed')
}
`
    : ''
}
${
  dependencies['@imatomix/mix-compress']
    ? `
import { Mixer as CompressMixer } from '@imatomix/mixer'
import { compress } from '@imatomix/mix-compress'

const compressText = 'mixer compresses this text. '.repeat(100)
const compressApp = new CompressMixer().mix(compress(), () => compressText)
const compressServer = await listen(compressApp)
const squeezed = await fetch(\`http://127.0.0.1:\${compressServer.port}/\`, {
  headers: { 'accept-encoding': 'gzip' },
})
const squeezedText = await squeezed.text()
await compressServer.close()
if (
  squeezed.headers.get('content-encoding') !== 'gzip' ||
  !squeezed.headers.get('vary')?.includes('Accept-Encoding') ||
  squeezedText !== compressText
) {
  throw new Error('mixer + mix-compress smoke test failed')
}
`
    : ''
}
${
  dependencies['@imatomix/mix-logger']
    ? `
import { Mixer as LoggerMixer } from '@imatomix/mixer'
import { type LogEvent, type LoggerState, logger } from '@imatomix/mix-logger'

const events: LogEvent[] = []
let resolveAccess: () => void = () => {}
const accessed = new Promise<void>((resolve) => {
  resolveAccess = resolve
})
const loggerApp = new LoggerMixer<LoggerState>().mix(
  logger({
    write: (event) => {
      events.push(event)
      if (event.kind === 'access') resolveAccess()
    },
  }),
  (ctx) => {
    ctx.state.log.info('handled')
    return 'logged'
  },
)
const loggerServer = await listen(loggerApp)
const loggedResponse = await fetch(\`http://127.0.0.1:\${loggerServer.port}/log?secret=1\`)
await loggedResponse.text()
await accessed
await loggerServer.close()
const [handled, access] = events
if (
  handled?.message !== 'handled' ||
  access?.method !== 'GET' ||
  access.path !== '/log' ||
  access.status !== 200 ||
  handled.requestId !== access.requestId ||
  loggedResponse.headers.get('x-request-id') !== access.requestId
) {
  throw new Error('mixer + mix-logger smoke test failed')
}
`
    : ''
}
const runtimeName = process.versions.bun ? \`bun \${process.versions.bun} (serve from @imatomix/mixer/bun)\` : \`node \${process.versions.node} (serve from @imatomix/mixer/node)\`
console.log(\`ok on \${runtimeName}\`)
`
writeFileSync(join(consumer, 'smoke.ts'), smoke)

run(join(root, 'node_modules', '.bin', 'tsc'), ['-p', consumer], consumer)
console.log('Type check: ok')
const smokeResult =
  runtime === 'workers'
    ? await verifyOnWorkers({ root, consumer, run })
    : run(runtime, [join('out', 'smoke.js')], consumer)
// Make sure the smoke test really ran on the requested runtime instead of silently falling back to another one
const expectedRuntime = runtime === 'workers' ? 'workerd' : runtime
if (!smokeResult.startsWith(`ok on ${expectedRuntime} `)) {
  throw new Error(`Smoke test did not run on ${runtime}: ${smokeResult}`)
}
console.log(`Runtime imports and smoke test: ${smokeResult}`)
