// Checks that a pull request title follows Conventional Commits.
// PRs are squash-merged, so the title becomes the commit message on main.
// The title is read from the PR_TITLE environment variable rather than being
// interpolated into a shell command, so it is never executed.

const TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
]

const PATTERN = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9-]+\\))?!?: \\S.*$`)

const title = process.env.PR_TITLE ?? ''

if (PATTERN.test(title)) {
  console.log(`PR title OK: ${title}`)
} else {
  console.error(
    `PR title does not follow Conventional Commits: ${JSON.stringify(title)}`,
  )
  console.error('Expected: <type>(<optional-scope>)!: <description>')
  console.error(`Types: ${TYPES.join(', ')}`)
  console.error('Example: feat(mix-router): support 405 Method Not Allowed')
  process.exitCode = 1
}
