# mixer

Minimal & asynchronous web module と、その周辺モジュールの monorepo。

各パッケージは npm に個別に公開されるので、必要なものだけ選んで導入できる。

| パッケージ | 説明 |
| --- | --- |
| [@imatomix/mixer](packages/mixer) | 本体 |
| [@imatomix/mix-router](packages/mix-router) | 型安全なルーター |
| [@imatomix/mix-cors](packages/mix-cors) | CORS |
| [@imatomix/mix-static](packages/mix-static) | 静的ファイルの配信 |
| [@imatomix/mix-session](packages/mix-session) | サーバ側セッション |

## Development

[pnpm](https://pnpm.io/) workspaces を使っている。

```sh
pnpm install
pnpm check    # lint + typecheck + test（全パッケージ）
pnpm build
pnpm --filter @imatomix/mixer test   # 特定のパッケージだけ
```
