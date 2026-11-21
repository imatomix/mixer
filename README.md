# mixer

English | [日本語](README.ja.md)

A monorepo for mixer, a minimal and asynchronous web module, and its modules.

Each package is published to npm separately, so you can install only the ones you need.

| Package | Description |
| --- | --- |
| [@imatomix/mixer](packages/mixer) | The core |
| [@imatomix/mix-router](packages/mix-router) | Type-safe router |
| [@imatomix/mix-cors](packages/mix-cors) | CORS |
| [@imatomix/mix-static](packages/mix-static) | Static file serving |
| [@imatomix/mix-session](packages/mix-session) | Server-side sessions |
| [@imatomix/mix-logger](packages/mix-logger) | Access logging |

## Development

This repository uses [pnpm](https://pnpm.io/) workspaces.

```sh
pnpm install
pnpm check    # lint + type check + tests for all packages
pnpm build
pnpm --filter @imatomix/mixer test   # a single package
```

Packages run on Node.js 24 or later and Bun 1.4.4 or later. See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.
