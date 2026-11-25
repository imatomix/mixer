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
  post('/echo', (ctx) => ctx.json()),
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
| [@imatomix/mixer](packages/mixer) | 本体: コンポーネント、`ctx`、応答、Cookie、エラー、Node.js・Bun アダプタ | Node.js、Bun、Workers |
| [@imatomix/mix-router](packages/mix-router) | 型安全なルーター | Node.js、Bun、Workers |
| [@imatomix/mix-cors](packages/mix-cors) | CORS | Node.js、Bun、Workers |
| [@imatomix/mix-csrf](packages/mix-csrf) | `Sec-Fetch-Site` と `Origin` による CSRF 対策 | Node.js、Bun、Workers |
| [@imatomix/mix-secure-headers](packages/mix-secure-headers) | `X-Frame-Options`・HSTS・CSP などのセキュリティヘッダー | Node.js、Bun、Workers |
| [@imatomix/mix-static](packages/mix-static) | 静的ファイル | Node.js、Bun |
| [@imatomix/mix-compress](packages/mix-compress) | 直接公開するアプリの応答の圧縮（Brotli、gzip） | Node.js、Bun |
| [@imatomix/mix-session](packages/mix-session) | サーバサイドセッション | Node.js、Bun、Workers（外部のストアを使う） |
| [@imatomix/mix-logger](packages/mix-logger) | リクエスト単位のログ。リクエスト ID・アクセスログ・エラーを結び付ける | Node.js、Bun、Workers |

まずは [mixer の README](packages/mixer/README.ja.md) から。どこに何があるかは[ドキュメントの地図](docs/README.ja.md)を参照。対応環境は Node.js 24 以上、Bun 1.4.4 以上、Cloudflare Workers。PR ごとに、公開するときと同じ形にパッケージを作り、3 つすべてで確かめている。

> どのパッケージも 0.x なので、マイナーバージョンの間で API が変わることがある。

## おすすめの組み合わせ

コンポーネントは mix した順に動き、その順番も安全の一部になる。出発点を 2 つ示す。

### ブラウザにページを返すアプリ

```ts
import { Mixer, redirect } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { csrf } from '@imatomix/mix-csrf'
import { type LoggerState, logger } from '@imatomix/mix-logger'
import { createRouter } from '@imatomix/mix-router'
import { secureHeaders } from '@imatomix/mix-secure-headers'
import { type SessionState, session } from '@imatomix/mix-session'
import { serveStatic } from '@imatomix/mix-static'

type State = LoggerState & SessionState<{ userId: string }>
const { get, post } = createRouter<State>()

const app = new Mixer<State>().mix(
  logger(), // 最初に。すべてのリクエストとエラーを 1 つの ID で記録する
  secureHeaders({ csp: { 'default-src': ["'self'"] } }),
  serveStatic('public'), // ファイルをキャッシュさせるため session() より前に
  csrf(), // 状態を変えるものより前に
  session(), // ログイン中のページをキャッシュに残さない
  get('/login', loginPage),
  post('/login', signIn), // 成功したら ctx.state.session.regenerate() を呼ぶ
  (ctx) =>
    ctx.state.session.get('userId') ? undefined : redirect('/login', { status: 303 }),
  get('/', home), // ここから下はログインが必要
)

await serve(app, { port: 3000 })
```

- フォームは `ctx.form()` で読み、値はすべて確かめる。POST には `redirect(path, { status: 303 })` で答える
- mixer は HTML を作らない。[Eta](https://eta.js.org/) や [Handlebars](https://handlebarsjs.com/) のように既定でエスケープするテンプレートエンジンか、React などの JSX のレンダラーを使う。エスケープで守れるのは本文と引用符で囲んだ属性だけで、利用者が選んだ URL（`javascript:`）、引用符のない属性、`<script>`・`<style>`・イベント属性の中の値は守れない。それらの値は自分で確かめる。React のフロントをファイルとして配るときは[SPA と組み合わせる](docs/how-to/spa.ja.md)を参照
- [examples/todo](examples/todo) は、この形で作った完全なアプリ。テスト付きで、Node.js・Bun・Workers で動く

### JSON の API

```ts
import { HttpError, Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { cors } from '@imatomix/mix-cors'
import { type LoggerState, logger } from '@imatomix/mix-logger'
import { createRouter } from '@imatomix/mix-router'

const { post } = createRouter<LoggerState>()

const app = new Mixer<LoggerState>().mix(
  logger(),
  cors({ origin: 'https://app.example.com' }), // 別のサイトのブラウザから呼ばれるときだけ
  post('/items', async (ctx) => {
    const data = await ctx.json() // 本文が JSON でなければ 415
    if (typeof data !== 'object' || data === null) throw new HttpError(400)
    // ...使う前に各フィールドを確かめる
    ctx.status = 201
    return data
  }),
)

await serve(app, { port: 3000 })
```

- `Authorization` ヘッダーのトークンで認証するなら、CSRF 対策はいらない。Cookie で認証する API なら、ルートより前に `csrf()` を置き、mix-cors で認証情報付きの送信を許したオリジンを `trustedOrigins` にも並べる
- Bun では `serve` を `@imatomix/mixer/bun` から読み込む。Cloudflare Workers では `export default app`

## 開発

このリポジトリは [pnpm](https://pnpm.io/) のワークスペース。

```sh
pnpm install
pnpm check                           # 全パッケージの lint・型チェック・テスト
pnpm --filter @imatomix/mixer test   # 1 つのパッケージだけ
```

開発に参加するときは [CONTRIBUTING.md](CONTRIBUTING.md)（英語）を、脆弱性の報告は [SECURITY.md](SECURITY.md) を参照。
