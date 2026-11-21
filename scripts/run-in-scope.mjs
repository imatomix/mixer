// Temporary helper for the Web standard migration: runs a package script only in the
// packages listed in migration-scope.json, because packages that have not been migrated
// yet do not type-check against the new core. Removed when the migration is finished.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const script = process.argv[2]
if (!script) {
  console.error('Usage: node scripts/run-in-scope.mjs <script>')
  process.exit(1)
}

const scope = JSON.parse(
  readFileSync(join(import.meta.dirname, 'migration-scope.json'), 'utf8'),
)
console.log(`Migration scope: ${scope.join(', ')}`)

for (const name of scope) {
  execFileSync('pnpm', ['--filter', name, '--if-present', script], {
    stdio: 'inherit',
  })
}
