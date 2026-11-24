# @imatomix/mixer

[English](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.md) | 日本語

Web 標準の `Request` / `Response` で動く、小さな Web フレームワーク。アプリを関数の並びとして書くと、mixer がその戻り値を安全な応答にする。

- **Web 標準。** `app.fetch(request)` は `Request` を受け取って `Response` を返すので、同じアプリが Node.js・Bun・Cloudflare Workers で動き、Next.js・Nuxt・SvelteKit・React Router の中でも動く
- **何もしなくても安全。** `nosniff`、Cookie の属性、Cookie を含む応答のキャッシュ、エラーの応答が、追加のコードなしで正しくなる（[後述](#何もしなくても安全)）
- **必要なものだけ選べる。** ルーティング・CORS・CSRF 対策・セキュリティヘッダー・静的ファイル・セッション・ログは[別のモジュール](#モジュール)で、どれも差し替えられる
- TypeScript 製・ESM のみ・依存ゼロ。Node.js 24 以上、Bun 1.4.4 以上、または Cloudflare Workers

> mixer は 0.x なので、マイナーバージョンの間で API が変わることがある。

## すぐ始める

```sh
npm install @imatomix/mixer @imatomix/mix-router
```

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { get, post } from '@imatomix/mix-router'

const app = new Mixer().mix(
  get('/', () => 'Hello mixer'),
  get('/hello/:name', (ctx, { name }) => ({ hello: name })),
  post('/echo', (ctx) => ctx.json()),
)

await serve(app, { port: 3000 })
```

http://localhost:3000 を開く。Bun では代わりに `@imatomix/mixer/bun` からインポートした `serve` を使う。ほかの動かし方は[アプリを動かす](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md)を参照。

## 基本

### コンポーネント

アプリは**コンポーネント**の並びで、`mix()` で足していく。[mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router) のルートもコンポーネントで、ログ・セキュリティヘッダー・CSRF 対策・セッションなどの[モジュール](#モジュール)もコンポーネント。

```ts
import { csrf } from '@imatomix/mix-csrf'
import { logger } from '@imatomix/mix-logger'
import { get } from '@imatomix/mix-router'
import { secureHeaders } from '@imatomix/mix-secure-headers'

app.mix(
  logger(), // 部品は最初に置く。後ろのすべての応答に効く
  secureHeaders(),
  csrf(),
  get('/', () => 'Hello mixer'),
)
```

コンポーネントは `mix()` した順に実行され、**値（`undefined` 以外）を返したところで止まる**。どれも返さなければ `404` になる。`ctx` に入っているものと、コンポーネントが返せる値は[リファレンス](https://github.com/imatomix/mixer/blob/main/docs/reference/context.ja.md)にある。

### ルートをファイルに分ける

1 つのリソースのルートは、載せる場所のパスを書かずに 1 つのファイルにまとめ、アプリを組み立てるところで前置きのパスを付ける。

```ts
// routes/users.ts
import { get, post } from '@imatomix/mix-router'

export const userRoutes = [
  get('/', () => [{ id: '1', name: 'Alice' }]),
  get('/:id', (ctx, { id }) => ({ id })),
  post('/', async (ctx) => ctx.json()),
]
```

```ts
// app.ts
import { namespace } from '@imatomix/mix-router'
import { userRoutes } from './routes/users.js'

app.mix(namespace('/users')(...userRoutes))
```

### 自分でコンポーネントを書く

コンポーネントは `ctx` を受け取る関数。何も返さなければ次へ進み、値を返せばそれが応答になる。`HttpError` を投げてもよい。

```ts
import { HttpError } from '@imatomix/mixer'

app.mix(
  (ctx) => {
    if (!ctx.request.headers.has('authorization')) throw new HttpError(401)
    // 何も返さない: 次へ進む
  },
  get('/admin', () => 'only with a token'),
)
```

後ろが応答を作ったあとで何かをしたいとき（すべての応答にヘッダーを足すなど）は、2 つ目の引数の `next` を使う。ルートやモジュールを使うだけなら要らない。mixer のモジュールは中でこれを使っている。

```ts
app.mix(
  async (ctx, next) => {
    const started = Date.now()
    await next() // このコンポーネントより後ろをすべて実行する
    ctx.headers.set('X-Response-Time', `${Date.now() - started}ms`)
  },
  get('/', () => 'Hello mixer'),
)
```

規則は [next() によるコンポーネントの組み立て](https://github.com/imatomix/mixer/blob/main/docs/explanation/composition.ja.md) を参照。

## 何もしなくても安全

設定しなくても、mixer は `nosniff` を送り、Cookie に安全な属性を付け、Cookie 付きの応答を共有キャッシュに置かせず、エラーは詳細なしで答え、リクエストボディの大きさを制限し、リダイレクトはサイトの中だけにする。`serve()` は `127.0.0.1` で待ち受け、知らないホスト名を拒否する。CSRF 対策とセキュリティヘッダーはアプリによって変わるので、mix-csrf と mix-secure-headers でそれぞれ 1 行で加える。

全体の一覧と、mixer が代わりに決められないことは[何もしなくても安全](https://github.com/imatomix/mixer/blob/main/docs/explanation/safety.ja.md)を参照。

## ドキュメント

やりたいことから探すには[ドキュメントの地図](https://github.com/imatomix/mixer/blob/main/docs/README.ja.md)を使う。主なページ:

- **アプリを動かす**: [Node.js・Bun・Cloudflare Workers・ほかのフレームワークの中](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.ja.md)
- **よくある作業**: [ユーザーのサインインとルートの前での確認](https://github.com/imatomix/mixer/blob/main/docs/how-to/auth-and-guards.ja.md)、[リクエストボディを読んで確かめる](https://github.com/imatomix/mixer/blob/main/docs/how-to/request-body.ja.md)、[イベントを送る・応答のあとに処理する](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.ja.md)、[アプリをテストする](https://github.com/imatomix/mixer/blob/main/docs/how-to/testing.ja.md)
- **調べる**: [Mixer のオプションと型](https://github.com/imatomix/mixer/blob/main/docs/reference/mixer.ja.md)、[ctx](https://github.com/imatomix/mixer/blob/main/docs/reference/context.ja.md)、[応答・エラー・Cookie](https://github.com/imatomix/mixer/blob/main/docs/reference/responses.ja.md)
- **設計を理解する**: [何もしなくても安全](https://github.com/imatomix/mixer/blob/main/docs/explanation/safety.ja.md)、[next() による組み立て](https://github.com/imatomix/mixer/blob/main/docs/explanation/composition.ja.md)、[設計判断の記録](https://github.com/imatomix/mixer/tree/main/docs/adr)

## モジュール

必要なものだけ入れる。どれもコンポーネントなので、自作のものに差し替えられる。

| パッケージ | 説明 |
| --- | --- |
| [@imatomix/mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router) | 型安全なルーター |
| [@imatomix/mix-cors](https://github.com/imatomix/mixer/tree/main/packages/mix-cors) | CORS |
| [@imatomix/mix-csrf](https://github.com/imatomix/mixer/tree/main/packages/mix-csrf) | CSRF 対策 |
| [@imatomix/mix-secure-headers](https://github.com/imatomix/mixer/tree/main/packages/mix-secure-headers) | セキュリティヘッダー |
| [@imatomix/mix-static](https://github.com/imatomix/mixer/tree/main/packages/mix-static) | 静的ファイル（Node.js と Bun） |
| [@imatomix/mix-session](https://github.com/imatomix/mixer/tree/main/packages/mix-session) | サーバサイドセッション |
| [@imatomix/mix-logger](https://github.com/imatomix/mixer/tree/main/packages/mix-logger) | リクエスト単位のログ |
| [@imatomix/mix-compress](https://github.com/imatomix/mixer/tree/main/packages/mix-compress) | 応答の圧縮（Node.js と Bun） |

## 開発

[リポジトリのルート](https://github.com/imatomix/mixer/tree/main)と [CONTRIBUTING.md](https://github.com/imatomix/mixer/blob/main/CONTRIBUTING.md) を参照。
