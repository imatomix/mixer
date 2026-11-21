# Contributing to mixer

Thanks for your interest in contributing! This document explains how to set up the project, how changes are proposed, and the conventions the codebase follows.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security vulnerability, see [SECURITY.md](SECURITY.md) instead of opening an issue.

## Before you start

- **Bug fixes and small improvements**: feel free to open a pull request directly.
- **New features, new packages, and breaking changes**: open an issue first so that the design can be agreed on before you spend time on the implementation.

## Development setup

Requirements:

- Node.js **26** for development (packages support Node.js `>=24`). The version is pinned in [`.node-version`](.node-version).
- [pnpm](https://pnpm.io/), in the version pinned by `packageManager` in [`package.json`](package.json). The easiest way to get it is Corepack. Corepack is no longer bundled with Node.js 25 and later, so install it from npm first:

```sh
npm install --global corepack@latest
corepack enable
pnpm install
```

## Commands

```sh
pnpm check                           # lint + type check + tests for all packages
pnpm verify:pack                     # pack each package, install it into a scratch project, and check types and runtime imports
pnpm format                          # format and fix lint issues with biome
pnpm --filter @imatomix/<name> test  # run the tests of a single package
pnpm check:pr-title                  # check PR_TITLE against the PR title rules
```

`pnpm check` must pass before a pull request can be merged. Run `pnpm verify:pack` as well when you change `package.json` (`exports`, `files`, dependencies) or the build setup.

## Branches, commits, and pull requests

- Create a branch from `master` named after the kind of change: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `ci/`, `build/`, or `chore/` (for example `fix/router-trailing-slash`).
- Write commit messages and pull request titles in English, following [Conventional Commits](https://www.conventionalcommits.org/):

  ```
  <type>(<optional-scope>)!: <description>

  feat(mix-router): support 405 Method Not Allowed
  fix(mixer): close the response stream when a send hook fails
  docs: clarify the session store contract
  ```

  - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
  - The scope is a package name without the `@imatomix/` prefix (`mixer`, `mix-router`, ...) and may be omitted for repository-wide changes.
  - Add `!` after the type or scope for breaking changes, and explain the migration in the pull request description.
- Pull requests are **squash-merged**, so the pull request title becomes the commit message on `master`. CI checks the title format.
- Fill in the pull request template. A pull request should contain one logical change; split unrelated changes into separate pull requests.

## Tests

- Write the test first, watch it fail, then implement the change.
- Tests live in `packages/<name>/test/*.test.ts` and use [vitest](https://vitest.dev/).
- Start a real server with `new Mixer().mix(...)` and `listen(0, '127.0.0.1')`, then call it with `fetch`. Do not use mocked `req` / `res` objects.
- Close servers in `afterEach` so that no ports are left open.
- Name tests after the behavior they check (for example `returns 204 for preflight requests`).

## Design principles

The goal is that users can pick only the modules they need and replace any of them with another implementation.

- Every `mix-*` package depends on `@imatomix/mixer` as a **peer dependency**, so that an application has exactly one instance of mixer.
- `mix-*` packages may use mixer's **public API** (anything exported from `packages/mixer/src/index.ts`, such as `HttpError`) at runtime, but never its internals.
- `mix-*` packages never depend on each other.
- Do not add properties to `ctx.req` or `ctx.res`. Pass values to later components through `ctx.state` and export its type.
- Respond by returning a value or calling `ctx.send()`. Return `undefined` to hand over to the next component.
- Throw `HttpError` for error responses instead of sending them directly, so that users can customize them with `onError`.
- Use `ctx.onBeforeSend()` for work that must happen right before the response is sent, and the `finish` / `close` events of `ctx.res` for work after it.
- Do not add runtime dependencies without discussing it in an issue first.

## Directory layout and naming

```
packages/<name>/
  src/           # source (index.ts is the public entry point)
  test/          # *.test.ts
  README.md      # English
  README.ja.md   # Japanese
scripts/         # repository tooling (verify-pack, PR title check)
.github/         # CI workflows, templates, CODEOWNERS
```

- Package names: `@imatomix/mixer` and `@imatomix/mix-<name>`.
- File names: kebab-case (`memory-store.ts`, `serve-file.test.ts`).
- Public functions are named exports in camelCase (`serveStatic`, `createRouter`); types and classes are PascalCase. No default exports.
- TypeScript in strict mode, ESM only. Use the `.js` extension in relative imports and the `node:` prefix for Node.js built-ins.
- Formatting and linting are handled by biome (2 spaces, single quotes, no semicolons).
- Code comments explain *why*, not *what*.
