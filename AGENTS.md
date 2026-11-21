# Agent instructions

This file is the canonical instruction set for AI coding agents (Claude Code, Codex, and others) working in this repository. Human contributors should read [CONTRIBUTING.md](CONTRIBUTING.md); agents must follow both.

## Project

A pnpm workspaces monorepo for `@imatomix/mixer`, a minimal and asynchronous web framework for Node.js, and its modules.

- `packages/mixer`: the core. Provides `Mixer`, `Context`, `Component`, `HttpError`, and cookies.
- `packages/mix-*`: optional modules (router, CORS, static files, sessions, logging). Each is published to npm separately so that users can pick only what they need.
- Shared configuration lives at the root: `tsconfig.base.json`, `biome.json`, `pnpm-workspace.yaml` (dependency versions are managed with `catalog:`), `vitest.shared.ts`.
- Inside the monorepo, packages resolve each other from `src` through the `@imatomix/source` export condition, so tests do not need a build. `pnpm verify:pack` checks the published `dist` output.

## Language

- Everything committed to the repository is in English: code comments, test names, error messages, documentation (except `README.ja.md`), commit messages, pull request titles and descriptions, and review replies.
- Talk to the maintainer in **Japanese**.
- `README.md` and `README.ja.md` must describe the same content. Update both when one changes.

## Commands

See [CONTRIBUTING.md](CONTRIBUTING.md#commands). The ones that matter most:

```sh
pnpm format       # run before every commit
pnpm check        # lint + type check + tests; must pass before you report work as done
pnpm verify:pack  # required when package.json (exports, files, dependencies) or the build setup changes
```

## How to work

- **Tests first.** Write the test, run it, and watch it fail for the expected reason before changing the code. Bug fixes start with a test that reproduces the bug.
- **Verify before claiming.** Report work as done only after `pnpm check` (and `pnpm verify:pack` when relevant) has passed in this session, and state the result.
- **Commits.** One logical change per commit, Conventional Commits in English (see [CONTRIBUTING.md](CONTRIBUTING.md#branches-commits-and-pull-requests)). Do not mix unrelated changes.
- **Branches and pull requests.** Never commit to `master`; it is protected and only accepts pull requests that pass CI. Work on a branch named after the change (`feat/`, `fix/`, `docs/`, ...). Pull requests are squash-merged, so the title becomes the commit message.
- **Merging.** Do not merge your own pull request unless the maintainer explicitly asks you to. Report the CI and review results and let the maintainer decide.
- **Reviews.** When a reviewer (human or bot) leaves findings, verify each one before acting on it. Fix what is valid with a test first, reply in the thread with the fixing commit, and explain why when you disagree.
- **Recommend, don't just list.** When there are several options, give the trade-offs and recommend one with a reason. Treat the maintainer's opinions as input for discussion; record something as a rule only when the maintainer decides it.

## Design principles

The goal is that users can pick only the modules they need and replace any of them with another implementation. The rules in [CONTRIBUTING.md](CONTRIBUTING.md#design-principles) apply. In addition:

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
