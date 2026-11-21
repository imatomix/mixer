// 公開物（npm pack した tarball）を、利用者と同じ条件でインストールして型と実行時の import を検証する。
// monorepo 内では @imatomix/source condition で src を参照しているため、dist の不備はテストでは気づけない。
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
// pnpm run 経由で起動すると pnpm 用の npm_config_* が渡り、npm が警告を出すので取り除く
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
  // 未移行のパッケージ（lib/*.js のまま）は対象外
  .filter(({ manifest }) => manifest.files?.includes('dist'))

const work = mkdtempSync(join(tmpdir(), 'mixer-verify-pack-'))
console.log(`作業ディレクトリ: ${work}`)

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
      `${manifest.name}: 公開物に不要なファイルが含まれています: ${unexpected.join(', ')}`,
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
      // 型チェックした smoke.ts をそのまま JS にして実行する
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
      `if (Object.keys(pkg${i}).length === 0) throw new Error('${name} の export が空です')`,
  )
  .join('\n')

const smoke = `${imports}
${checks}
${
  dependencies['@imatomix/mix-router']
    ? `
import { Mixer } from '@imatomix/mixer'
import { get } from '@imatomix/mix-router'

const app = new Mixer().mix(get('/hello/:name', (_ctx, { name }) => ({ hello: name })))
await app.listen(0, '127.0.0.1')
const res = await fetch(\`http://127.0.0.1:\${app.address?.port}/hello/mixer\`)
const body = await res.json()
await app.close()
if (body.hello !== 'mixer') throw new Error('mixer + mix-router の動作確認に失敗しました')
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
    return 'ok'
  }
  return { user: current.get('user') }
})
await sessionApp.listen(0, '127.0.0.1')
const base = \`http://127.0.0.1:\${sessionApp.address?.port}\`
const login = await fetch(\`\${base}/login\`)
const sid = login.headers.getSetCookie()[0]?.split(';')[0]
const me = await (await fetch(\`\${base}/me\`, { headers: { cookie: sid ?? '' } })).json()
await sessionApp.close()
if (me.user !== 'mixer') throw new Error('mixer + mix-session の動作確認に失敗しました')
`
    : ''
}
console.log('ok')
`
writeFileSync(join(consumer, 'smoke.ts'), smoke)

run(join(root, 'node_modules', '.bin', 'tsc'), ['-p', consumer], consumer)
console.log('型チェック: ok')
console.log(
  `実行時の import と動作確認: ${run('node', [join('out', 'smoke.js')], consumer)}`,
)
