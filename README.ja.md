# mixer

[English](README.md) | 日本語

Web 標準の `Request` / `Response` で動く、小さな Web フレームワーク。何もしなくても安全で、使う部品だけを選んで組み立てる。

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { csrf } from '@imatomix/mix-csrf'
import { logger } from '@imatomix/mix-logger'
import { get, post } from '@imatomix/mix-router'
import { secureHeaders } from '@imatomix/mix-secure-headers'

const app = new Mixer().mix(
  logger(),
  secureHeaders(),
  csrf(),
  get('/hello/:name', (ctx, { name }) => ({ hello: name })),
  post('/echo', (ctx) => ctx.body()),
)

await serve(app, { port: 3000 })
```

- **Web 標準。** `app.fetch(request)` は `Response` を返すので、同じアプリが Node.js・Bun・Cloudflare Workers で動き、Next.js・Nuxt・SvelteKit・React Router の中でも動く
- **何もしなくても安全。** `nosniff`、Cookie の属性、Cookie を含む応答のキャッシュ、エラーの応答、ボディの上限、リダイレクト、ホスト名の確認は、本体が追加のコードなしで正しくする。CSRF 対策とセキュリティヘッダーはアプリによって変わるので、上の例のようにそれぞれ 1 行で加える
- **必要なものだけ選べる。** 本体は依存ゼロ。ルーティング・CORS・CSRF 対策・セキュリティヘッダー・静的ファイル・セッション・ログは別のパッケージで、どの部品もただの関数なので差し替えられる
- **型が付く。** ルートのパラメータはパスから推論され、`ctx.state` と `ctx.env` には自分の型を付けられる

## パッケージ

| パッケージ | 説明 | 動く場所 |
| --- | --- | --- |
| [@imatomix/mixer](packages/mixer) | 本体: コンポーネント、`ctx`、応答、Cookie、エラー、Node.js アダプタ | Node.js、Bun、Workers |
| [@imatomix/mix-router](packages/mix-router) | 型安全なルーター | Node.js、Bun、Workers |
| [@imatomix/mix-cors](packages/mix-cors) | CORS | Node.js、Bun、Workers |
| [@imatomix/mix-csrf](packages/mix-csrf) | `Sec-Fetch-Site` と `Origin` による CSRF 対策 | Node.js、Bun、Workers |
| [@imatomix/mix-secure-headers](packages/mix-secure-headers) | `X-Frame-Options`・HSTS・CSP などのセキュリティヘッダー | Node.js、Bun、Workers |
| [@imatomix/mix-static](packages/mix-static) | 静的ファイル | Node.js、Bun |
| [@imatomix/mix-session](packages/mix-session) | サーバサイドセッション | Node.js、Bun、Workers（外部のストアを使う） |
| [@imatomix/mix-logger](packages/mix-logger) | アクセスログ | Node.js、Bun、Workers |

まずは [mixer の README](packages/mixer/README.ja.md) から。対応環境は Node.js 24 以上、Bun 1.4.4 以上、Cloudflare Workers。PR ごとに、公開するときと同じ形にパッケージを作り、3 つすべてで確かめている。

> どのパッケージも 0.x なので、マイナーバージョンの間で API が変わることがある。

## 開発

このリポジトリは [pnpm](https://pnpm.io/) のワークスペース。

```sh
pnpm install
pnpm check                           # 全パッケージの lint・型チェック・テスト
pnpm --filter @imatomix/mixer test   # 1 つのパッケージだけ
```

開発に参加するときは [CONTRIBUTING.md](CONTRIBUTING.md)（英語）を、脆弱性の報告は [SECURITY.md](SECURITY.md) を参照。
