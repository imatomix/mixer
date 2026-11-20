# mixer

Minimal & asynchronous web module と、その周辺モジュールの monorepo。

各パッケージは npm に個別に公開されるので、必要なものだけ選んで導入できる。

| パッケージ | 説明 |
| --- | --- |
| [@imatomix/mixer](packages/mixer) | 本体 |

## Development

[pnpm](https://pnpm.io/) workspaces を使っている。

```sh
pnpm install
pnpm check    # lint + typecheck + test（全パッケージ）
pnpm build
pnpm --filter @imatomix/mixer test   # 特定のパッケージだけ
```
