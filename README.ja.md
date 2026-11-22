# mixer

[English](README.md) | 日本語

Web 標準の `Request` / `Response` で動く、小さな Web フレームワーク。何もしなくても安全で、使う部品だけを選んで組み立てる。

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { cors } from '@imatomix/mix-cors'
import { logger } from '@imatomix/mix-logger'
import { get, post } from '@imatomix/mix-router'

const app = new Mixer().mix(
  logger(),
  cors({ origin: 'https://example.com' }),
  get('/hello/:name', (ctx, { name }) => ({ hello: name })),
  post('/echo', (ctx) => ctx.body()),
)

await serve(app, { port: 3000 })
```

- **Web 標準。** `app.fetch(request)` は `Response` を返すので、同じアプリが Node.js・Bun・Cloudflare Workers で動き、Next.js・Nuxt・SvelteKit・React Router の中でも動く
- **何もしなくても安全。** セキュリティのためのヘッダ、Cookie の属性、Cookie を含む応答のキャッシュ、エラーの応答、ホスト名の確認が、追加のコードなしで正しくなる
- **必要なものだけ選べる。** 本体は依存ゼロ。ルーティング・CORS・静的ファイル・セッション・ログは別のパッケージで、どの部品もただの関数なので差し替えられる
- **型が付く。** ルートのパラメータはパスから推論され、`ctx.state` と `ctx.env` には自分の型を付けられる

## パッケージ

| パッケージ | 説明 | 動く場所 |
| --- | --- | --- |
| [@imatomix/mixer](packages/mixer) | 本体: コンポーネント、`ctx`、応答、Cookie、エラー、Node.js アダプタ | Node.js、Bun、Workers |
| [@imatomix/mix-router](packages/mix-router) | 型安全なルーター | Node.js、Bun、Workers |
| [@imatomix/mix-cors](packages/mix-cors) | CORS | Node.js、Bun、Workers |
| [@imatomix/mix-static](packages/mix-static) | 静的ファイル | Node.js、Bun |
| [@imatomix/mix-session](packages/mix-session) | サーバサイドセッション | Node.js、Bun、Workers（外部のストアを使う） |
| [@imatomix/mix-logger](packages/mix-logger) | アクセスログ | Node.js、Bun、Workers |

まずは [mixer の README](packages/mixer/README.ja.md) から。対応環境は Node.js 24 以上、Bun 1.4.4 以上、Cloudflare Workers。PR ごとに、公開用のパッケージを 3 つすべてで確かめている。

> どのパッケージも 0.x なので、マイナーバージョンの間で API が変わることがある。

## 開発

このリポジトリは [pnpm](https://pnpm.io/) のワークスペース。

```sh
pnpm install
pnpm check                           # 全パッケージの lint・型チェック・テスト
pnpm --filter @imatomix/mixer test   # 1 つのパッケージだけ
```

開発に参加するときは [CONTRIBUTING.md](CONTRIBUTING.md)（英語）を、脆弱性の報告は [SECURITY.md](SECURITY.md) を参照。
