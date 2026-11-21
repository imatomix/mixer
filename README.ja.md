# mixer

[English](README.md) | 日本語

Web 標準の `Request` / `Response` で動く Minimal & asynchronous web module と、その周辺モジュールの monorepo。

各パッケージは npm に個別に公開されるので、必要なものだけ選んで導入できる。

| パッケージ | 説明 |
| --- | --- |
| [@imatomix/mixer](packages/mixer) | 本体 |
| [@imatomix/mix-router](packages/mix-router) | 型安全なルーター |
| [@imatomix/mix-cors](packages/mix-cors) | CORS |
| [@imatomix/mix-static](packages/mix-static) | 静的ファイルの配信 |
| [@imatomix/mix-session](packages/mix-session) | サーバ側セッション |
| [@imatomix/mix-logger](packages/mix-logger) | アクセスログ |

## Development

[pnpm](https://pnpm.io/) workspaces を使っている。

```sh
pnpm install
pnpm check    # lint + typecheck + test（全パッケージ）
pnpm build
pnpm --filter @imatomix/mixer test   # 特定のパッケージだけ
```

対応環境は Node.js 24 以上と Bun 1.4.4 以上。`app.fetch` で Next.js・Nuxt・SvelteKit・React Router のアプリの一部を受け持つこともできる。開発に参加するときは [CONTRIBUTING.md](CONTRIBUTING.md)（英語）を参照。
