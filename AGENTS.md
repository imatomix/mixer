# Agent instructions

This file is the canonical instruction set for AI coding agents (Claude Code, Codex, and others) working in this repository. Human contributors should read [CONTRIBUTING.md](CONTRIBUTING.md); agents must follow both.

## Project

A pnpm workspaces monorepo for `@imatomix/mixer`, a small web framework built on the Web standard `Request` and `Response` (running on Node.js, Bun, and Cloudflare Workers), and its modules.

- `packages/mixer`: the core. Provides `Mixer` (a Web standard `fetch(request) => Response` handler), `Context`, `Component`, `HttpError`, and cookies. The Node.js adapter `serve()` lives in the `@imatomix/mixer/node` subpath export.
- `packages/mix-*`: optional modules (router, CORS, static files, sessions, logging). Each is published to npm separately so that users can pick only what they need.
- Shared configuration lives at the root: `tsconfig.base.json`, `biome.json`, `pnpm-workspace.yaml` (dependency versions are managed with `catalog:`), `vitest.shared.ts`.
- Inside the monorepo, packages resolve each other from `src` through the `@imatomix/source` export condition, so tests do not need a build. `pnpm verify:pack` checks the published `dist` output.

## Language

- Everything committed to the repository is in English: code comments, test names, error messages, documentation (except `README.ja.md`), commit messages, pull request titles and descriptions, and review replies.
- Reply to your user in the language they use. The maintainer ([@imatomix](https://github.com/imatomix)) works in **Japanese**, so use Japanese when you are working for the maintainer.
- `README.md` and `README.ja.md` must describe the same content. Update both when one changes.

## Commands

See [CONTRIBUTING.md](CONTRIBUTING.md#commands). The ones that matter most:

```sh
pnpm format       # run before every commit
pnpm check        # lint + type check + tests; must pass before you report work as done
pnpm verify:pack  # required when package.json (exports, files, dependencies) or the build setup changes
```

## How to work

- **Tests first.** Write the test, run it, and watch it fail for the expected reason before changing the code. Bug fixes start with a test that reproduces the bug. A change that only restructures code relies on the existing tests instead ([Tests for refactoring](CONTRIBUTING.md#tests-for-refactoring)).
- **Code conventions.** Follow [Code conventions](CONTRIBUTING.md#code-conventions): one role per file, routes in one file per resource, examples in patterns users already know, and error messages that never show secrets or client input in full.
- **Verify before claiming.** Report work as done only after `pnpm check` (and `pnpm verify:pack` when relevant) has passed in this session, and state the result.
- **Commits.** One logical change per commit, Conventional Commits in English (see [CONTRIBUTING.md](CONTRIBUTING.md#branches-commits-and-pull-requests)). Do not mix unrelated changes.
- **Branches and pull requests.** Never commit to `main`; it is protected and only accepts pull requests that pass CI. Work on a branch named after the change (`feat/`, `fix/`, `docs/`, ...). Pull requests are squash-merged, so the title becomes the commit message.
- **Merging.** Do not merge your own pull request unless the maintainer explicitly asks you to. Report the CI and review results and let the maintainer decide.
- **Reviews.** When a reviewer (human or bot) leaves findings, verify each one before acting on it. Fix what is valid with a test first, reply in the thread with the fixing commit, and explain why when you disagree.
- **Recommend, don't just list.** When there are several options, give the trade-offs and recommend one with a reason. Treat the maintainer's opinions as input for discussion; record something as a rule only when the maintainer decides it.

## Design principles

Decisions that shape the design are recorded in [docs/adr](docs/adr). Read them before changing how components, modules, or the public API fit together, and add a record when you make such a decision.

mixer aims to be **safe by default and simple to write**, and treats both as equally important.

- Prefer designs that achieve both. A safe default should not require extra code, and a simple API should not leave a foot-gun.
- When they conflict, do not pick one silently: lay out the trade-off, recommend one option with a reason, and let the maintainer decide.

The goal is also that users can pick only the modules they need and replace any of them with another implementation. The rules in [CONTRIBUTING.md](CONTRIBUTING.md#design-principles) apply. In addition:

- **Changing mixer's public API needs the maintainer's agreement first.** If a `mix-*` change seems to need something new from mixer (a property, a type, a behavior change), stop and propose it before implementing. Do not work around a missing primitive inside a module. Once agreed, land the mixer change in its own commit with tests.
- Prefer putting a genuinely shared HTTP primitive (like cookies) in mixer over duplicating it in several modules.
- When mixer's public API changes, update the `peerDependencies` lower bound of the modules that use it and the combination checks in `scripts/verify-pack.mjs`.
- Peer ranges must be at least the version of mixer that introduced the APIs a module uses.
- Do not add runtime dependencies or new development tools without the maintainer's agreement.
- Before adding a new package, check whether extending an existing package or mixer itself is the better fit (for example, favicon serving is `serveFile` in mix-static, and cookies are part of mixer). To add one, follow [Adding a new package](CONTRIBUTING.md#adding-a-new-package).

## Security

These packages parse requests, serve files, and manage sessions, so treat security regressions as bugs.

- Keep path traversal, header injection, prototype pollution, and open redirect protections in place, and add tests for new input handling.
- Never commit secrets or personal information (including email addresses).
- Do not weaken checks to make a test pass. Find the cause instead.
