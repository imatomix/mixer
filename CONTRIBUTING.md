# Contributing to mixer

Thanks for your interest in contributing! This document explains how to set up the project, how changes are proposed, and the conventions the codebase follows.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security vulnerability, see [SECURITY.md](SECURITY.md) instead of opening an issue.

## Before you start

- **Bug fixes and small improvements**: feel free to open a pull request directly.
- **New features, new packages, and breaking changes**: open an issue first so that the design can be agreed on before you spend time on the implementation.

## Development setup

Requirements:

- Node.js **26** for development (packages support Node.js `>=24`). The version is pinned in [`.node-version`](.node-version).
- [Bun](https://bun.com/) 1.4.4 (optional) to run `pnpm verify:pack:bun` locally. CI runs it on every pull request.
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
pnpm verify:pack:bun                 # the same, with the final smoke test running on Bun (requires Bun)
pnpm verify:pack:workers             # the same, with a Worker running on workerd without Node.js compatibility
pnpm format                          # format and fix lint issues with biome
pnpm --filter @imatomix/<name> test  # run the tests of a single package
pnpm check:pr-title                  # check PR_TITLE against the PR title rules
```

`pnpm check` must pass before a pull request can be merged. Run `pnpm verify:pack` as well when you change `package.json` (`exports`, `files`, dependencies) or the build setup.

## Branches, commits, and pull requests

- Create a branch from `main` named after the kind of change: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `ci/`, `build/`, or `chore/` (for example `fix/router-trailing-slash`).
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
- Pull requests are **squash-merged**, so the pull request title becomes the commit message on `main`. CI checks the title format.
- When you revert a pull request with GitHub's **Revert** button, rename the generated title (`Revert "feat(mix-router): ..."`) to `revert: <original title>` (for example `revert: feat(mix-router): support 405 Method Not Allowed`) so that it passes the title check.
- Fill in the pull request template. A pull request should contain one logical change; split unrelated changes into separate pull requests.

## Tests

- Write the test first, watch it fail, then implement the change.
- Tests live in `packages/<name>/test/*.test.ts` and use [vitest](https://vitest.dev/).
- Call the app directly with `app.fetch(new Request('http://localhost/path'))`. No server or port is needed, and the test sees the same `Response` users get.
- Start a real server only for what `app.fetch` cannot show: the Node adapter itself (`packages/mixer/test/node.test.ts`) and paths that `Request` would normalize, such as `/../x` (send them as is over `node:http` through `serve()` from `@imatomix/mixer/node`). Close those servers in `afterEach`.
- The mix-session Redis store tests need a real Redis and are skipped unless `REDIS_URL` is set. Run one with `docker run --rm -p 127.0.0.1:6379:6379 redis:8.4-alpine` and set `REDIS_URL=redis://127.0.0.1:6379`; CI provides one.
- `pnpm verify:pack` runs the published packages end to end, with `serve()` on Node, `serve()` from `@imatomix/mixer/bun` on Bun, and a Worker on workerd (`scripts/workers-smoke/`).
- Name tests after the behavior they check (for example `returns 204 for preflight requests`).

## Design principles

The goal is that users can pick only the modules they need and replace any of them with another implementation.

- Every `mix-*` package depends on `@imatomix/mixer` as a **peer dependency**, so that an application has exactly one instance of mixer.
- `mix-*` packages may use mixer's **public API** (anything exported from `packages/mixer/src/index.ts`, such as `HttpError`) at runtime, but never its internals.
- `mix-*` packages never depend on each other.
- Pass values to later components through `ctx.state` and export its type. Do not add properties to `ctx` or `ctx.request`.
- Respond by returning a value or a `Response`; set `ctx.status` and `ctx.headers` for the draft. Return `undefined` to hand over to the next component.
- Match paths against `ctx.path`, so that modules work under `basePath`. Use `ctx.url` only when the full URL is needed (for example, a redirect `Location`).
- Keep modules runtime-neutral: use Web standard APIs (`Request`, `Headers`, `ReadableStream`, Web Crypto) and reach for `node:` modules only when the job needs them (such as `node:fs` in mix-static).
- Throw `HttpError` for error responses instead of sending them directly, so that users can customize them with `onError`.
- Use `ctx.onBeforeSend()` for work that must happen right before the response is built, `ctx.onResponse()` for work once it is ready, and `ctx.waitUntil()` for slow work that should not delay the response.
- Do not add runtime dependencies without discussing it in an issue first.

## Adding a new package

Open an issue first. A new package should not be something that fits better as an extension of an existing package or as a primitive in mixer itself.

1. **Package structure.** Copy the setup from an existing module such as `packages/mix-cors`:
   - `package.json`: `"type": "module"`, `exports` (`@imatomix/source` pointing at `src`, then `types` + `import`, so that other workspace packages and examples resolve it without a build), `files: ["dist"]`, `engines.node: ">=24"`, the same `scripts`, `peerDependencies` on `@imatomix/mixer`, and `devDependencies` with `"@imatomix/mixer": "workspace:*"` plus `catalog:` entries for `@types/node`, `tsup`, `typescript`, and `vitest`. Start at the version of the other packages.
   - `tsconfig.json`, `tsconfig.build.json`, `tsup.config.ts`, and `vitest.config.ts`. The vitest config is required so that mixer resolves from `src` through the `@imatomix/source` condition.
   - Run `pnpm install`.
2. **Tests first.** Write `test/*.test.ts` for the behavior you want, watch the tests fail, then implement `src/index.ts`. Export one function that takes options and returns a `Component`.
3. **Documentation.** Write `README.md` (English) and `README.ja.md` (Japanese), and add the package to the table in the root READMEs.
4. **Checks.** Run `pnpm format`, `pnpm check`, `pnpm --filter @imatomix/<name> build`, and `pnpm verify:pack`. The new package is picked up by `verify:pack` automatically; add a combination check to `scripts/verify-pack.mjs` if it interacts with mixer in a way worth checking end to end. Make sure `dist/index.js` imports nothing from mixer except its public API.

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
