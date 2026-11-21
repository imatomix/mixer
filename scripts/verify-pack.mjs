// Installs the published artifacts (npm pack tarballs) the way users would, and checks their types and runtime imports.
// Inside the monorepo, packages resolve each other from src through the @imatomix/source condition, so tests cannot catch problems in dist.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const migrationScope = JSON.parse(
  readFileSync(join(root, 'scripts', 'migration-scope.json'), 'utf8'),
)
console.log(`Migration scope: ${migrationScope.join(', ')}`)

// The packages are installed and type-checked once; only the final smoke test runs on the chosen runtime.
const runtimeArg = process.argv.find((arg) => arg.startsWith('--runtime='))
const runtime = runtimeArg ? runtimeArg.slice('--runtime='.length) : 'node'
if (runtime !== 'node' && runtime !== 'bun') {
  throw new Error(`Unknown runtime: ${runtime} (expected node or bun)`)
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
  // Temporary during the Web standard migration: only packages that have been migrated
  .filter(({ manifest }) => migrationScope.includes(manifest.name))

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
      target: 'ES2023',
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
${
  dependencies['@imatomix/mix-router']
    ? `
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { get } from '@imatomix/mix-router'

const app = new Mixer().mix(get('/hello/:name', (_ctx, { name }) => ({ hello: name })))
const server = await serve(app, { hostname: '127.0.0.1' })
const res = await fetch(\`http://127.0.0.1:\${server.port}/hello/mixer\`)
const body = await res.json()
await server.close()
if (body.hello !== 'mixer') throw new Error('mixer + mix-router smoke test failed')
`
    : ''
}
${
  dependencies['@imatomix/mix-session']
    ? `
import { Mixer as SessionMixer } from '@imatomix/mixer'
import { session, type SessionState } from '@imatomix/mix-session'

const sessionApp = new SessionMixer<SessionState>().mix(session(), (ctx) => {
  const current = ctx.state.session
  if (ctx.url.pathname === '/login') {
    current.set('user', 'mixer')
    // A second cookie checks that several Set-Cookie headers survive on this runtime
    ctx.cookies.set('theme', 'dark')
    return 'ok'
  }
  return { user: current.get('user') }
})
await sessionApp.listen(0, '127.0.0.1')
const base = \`http://127.0.0.1:\${sessionApp.address?.port}\`
const login = await fetch(\`\${base}/login\`)
const setCookies = login.headers.getSetCookie()
const sid = setCookies.find((cookie) => cookie.startsWith('sid='))?.split(';')[0]
const me = await (await fetch(\`\${base}/me\`, { headers: { cookie: sid ?? '' } })).json()
await sessionApp.close()
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
import { tmpdir as osTmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { Mixer as StaticMixer } from '@imatomix/mixer'
import { serve as serveStaticApp } from '@imatomix/mixer/node'
import { serveStatic } from '@imatomix/mix-static'

const publicDir = makeTempDir(joinPath(osTmpdir(), 'mixer-smoke-static-'))
writeTempFile(joinPath(publicDir, 'hello.txt'), 'hello static')
// A symbolic link inside the public directory that points outside it must never be served
const outsideDir = makeTempDir(joinPath(osTmpdir(), 'mixer-smoke-outside-'))
writeTempFile(joinPath(outsideDir, 'secret.txt'), 'secret')
symlinkSync(joinPath(outsideDir, 'secret.txt'), joinPath(publicDir, 'link.txt'))
const staticApp = new StaticMixer().mix(serveStatic(publicDir))
const staticServer = await serveStaticApp(staticApp, { hostname: '127.0.0.1' })
const staticBase = \`http://127.0.0.1:\${staticServer.port}\`
const file = await fetch(\`\${staticBase}/hello.txt\`)
const fileText = await file.text()
const etag = file.headers.get('etag') ?? ''
const headResponse = await fetch(\`\${staticBase}/hello.txt\`, { method: 'HEAD' })
await headResponse.text()
const notModified = await fetch(\`\${staticBase}/hello.txt\`, { headers: { 'if-none-match': etag } })
await notModified.text()
const escaped = await fetch(\`\${staticBase}/link.txt\`)
const escapedText = await escaped.text()
await staticServer.close()
if (
  fileText !== 'hello static' ||
  file.headers.get('content-type') !== 'text/plain; charset=utf-8' ||
  headResponse.status !== 200 ||
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
import { serve as serveCors } from '@imatomix/mixer/node'
import { cors } from '@imatomix/mix-cors'

const corsApp = new CorsMixer().mix(cors(), () => 'cors ok')
const corsServer = await serveCors(corsApp, { hostname: '127.0.0.1' })
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
  dependencies['@imatomix/mix-logger']
    ? `
import { Mixer as LoggerMixer } from '@imatomix/mixer'
import { type LogEntry, logger } from '@imatomix/mix-logger'

let resolveEntry: (entry: LogEntry) => void = () => {}
const logged = new Promise<LogEntry>((resolve) => {
  resolveEntry = resolve
})
const loggerApp = new LoggerMixer().mix(logger({ write: (entry) => resolveEntry(entry) }), () => 'logged')
await loggerApp.listen(0, '127.0.0.1')
await (await fetch(\`http://127.0.0.1:\${loggerApp.address?.port}/log?secret=1\`)).text()
const entry = await logged
await loggerApp.close()
if (entry.method !== 'GET' || entry.path !== '/log' || entry.status !== 200) {
  throw new Error('mixer + mix-logger smoke test failed')
}
`
    : ''
}
const runtimeName = process.versions.bun ? \`bun \${process.versions.bun}\` : \`node \${process.versions.node}\`
console.log(\`ok on \${runtimeName}\`)
`
writeFileSync(join(consumer, 'smoke.ts'), smoke)

run(join(root, 'node_modules', '.bin', 'tsc'), ['-p', consumer], consumer)
console.log('Type check: ok')
const smokeResult = run(runtime, [join('out', 'smoke.js')], consumer)
// Make sure the smoke test really ran on the requested runtime instead of silently falling back to another one
if (!smokeResult.startsWith(`ok on ${runtime} `)) {
  throw new Error(`Smoke test did not run on ${runtime}: ${smokeResult}`)
}
console.log(`Runtime imports and smoke test: ${smokeResult}`)
