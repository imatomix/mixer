# @imatomix/mix-router

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-router/README.md) | 日本語

[mixer](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md) の型安全なルーター。ルートは mixer のコンポーネントで、パラメータの型はパスから推論される。

- 動く場所: Node.js・Bun・Cloudflare Workers
- 0.x なので、マイナーバージョンの間で API が変わることがある

## インストール

```sh
npm install @imatomix/mixer @imatomix/mix-router
```

## 使い方

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { get, post } from '@imatomix/mix-router'

const app = new Mixer()

app.mix(
  get('/users/:id', (ctx, { id }) => ({ id })), // GET と HEAD の /users/42 → { "id": "42" }
  post('/users', async (ctx) => {
    ctx.status = 201
    return await ctx.json()
  }),
)

await serve(app, { port: 3000 })
```

ルートは mixer の Component なので、そのまま `mix()` に渡せる。
パスとメソッドが一致しなければ何もせず、次のコンポーネントへ進む。
ルートは mixer の `ctx.path` と照合するので、`new Mixer({ basePath: '/api' })` では `/api` より下のパスを書く。

## メソッド

```ts
get('/route', handler) // GET と HEAD
post('/route', handler)
put('/route', handler)
patch('/route', handler)
del('/route', handler) // DELETE
head('/route', handler)
options('/route', handler)
all('/route', handler) // すべてのメソッド
route(['PROPFIND', 'MKCOL'], '/route', handler) // 任意のメソッド
```

## パスパターン

| パターン | マッチ例 | params |
| --- | --- | --- |
| `/users` | `/users`, `/users/` | `{}` |
| `/users/:id` | `/users/42` | `{ id: '42' }` |
| `/files/*` | `/files`, `/files/a/b.txt` | `{ '*': 'a/b.txt' }` |

- `*` はパスの末尾にだけ置ける
- パラメータ名は JavaScript の識別子として使える名前（`:userId` など）で、1 つのパスの中で重複できない。違反すると定義時にエラーになる
- 固定部分もデコードしてから比べるので、`/ジュース` と `/%E3%82%B8%E3%83%A5%E3%83%BC%E3%82%B9` は同じパス
- params の各値は URL デコード済み（`/mix/%E3%82%8A%E3%82%93%E3%81%94` → `{ fruit: 'りんご' }`）
- クエリは mixer の `ctx.url.searchParams` で読む

### 型推論

params の型はパスの文字列から推論される。存在しないパラメータを参照すると型エラーになる。

```ts
get('/users/:userId/posts/:postId', (ctx, params) => {
  params.userId // string
  params.name // 型エラー
})
```

### 安全性

- 不正な URL エンコーディング（`/files/%E3%81` など）は `400 Bad Request` になる（mixer の `HttpError` を投げるので、`onError` で差し替えられる）
- デコードすると `/` や NUL 文字になるセグメント（`/files/..%2F..%2Fetc` など）は、どのルートにもマッチしない（最終的に mixer の 404 になる）
- 途中に空のセグメントを含むパス（`//admin/secret`、`/admin//secret`）もマッチしない。`/admin/secret` として扱うと、生のパスの前方一致で認可する別の層と解釈が食い違うため（末尾の `/` は区別しない）

`..` などのドットセグメントは、URL の解析時に正規化されている。
params はプロトタイプを持たないオブジェクト。

## ハンドラを複数並べる

ハンドラは `(ctx, params)` を受け取り、mixer と同じく**値を返したところで止まる**。
`undefined` を返すと次のハンドラへ進む。普通の Component もそのまま並べられる。

```ts
import { HttpError } from '@imatomix/mixer'

const requireAuth = (ctx) => {
  if (!ctx.request.headers.has('authorization')) throw new HttpError(401, 'Unauthorized')
}

get('/admin/users/:id', requireAuth, (ctx, { id }) => findUser(id))
```

## 405 Method Not Allowed

既定では、パスは合うがメソッドに合うルートがないリクエストも、ほかの合わないリクエストと同じく次へ進み、最後は `404` になる。代わりに `405` と `Allow` ヘッダで応答するには、ルートの後ろに `methodNotAllowed()` を mix する。

```ts
import { get, methodNotAllowed, post } from '@imatomix/mix-router'

app.mix(
  get('/users', listUsers),
  post('/users', createUser),
  methodNotAllowed(), // DELETE /users → 405、Allow: GET, HEAD, POST
)
```

- `405` になるのは、パスが合うルートがあり、メソッドを受け付けるルートが 1 つもないときだけ。メソッドを受け付けたが何も返さなかったルート、`all()` のルート、間にあって応答したコンポーネントがあれば、いつもどおりの動きになる
- `OPTIONS` には自分からは応答しない。`options()` のルートを書くか、preflight に応答する [mix-cors](https://github.com/imatomix/mixer/tree/main/packages/mix-cors) をルートより前に置く
- **`405` と `Allow` は、そのパスが存在することをクライアントに伝える。** 認証などの確認をルートのハンドラの中だけで行っているなら、ルートより前に置く（たとえば [group](#group-の中のコンポーネント) の先頭のコンポーネントにする）。そうすれば、認証されていないリクエストは何かを明かす前に拒否される

## group

ルートの先頭に共通のパスを付ける: `group(prefix, ...items)`。並べられるのは、ルート、コンポーネント、またはそれらの配列（1 つのファイルから export したルートなど）。入れ子にもできる。

```ts
import { get, group } from '@imatomix/mix-router'

app.mix(
  group(
    '/api',
    group('/v1', get('/', () => 'API V1')), // GET /api/v1
    get('/health', () => 'ok'), // GET /api/health
  ),
)
```

1 つのリソースのルートは、ふつう前置きのパスを書かずに 1 つのファイルにまとめ、アプリを組み立てるところで前置きのパスを付ける。

```ts
// routes/users.ts
import { get, post } from '@imatomix/mix-router'

export const userRoutes = [
  get('/', listUsers),
  post('/', createUser),
]
```

```ts
// app.ts
import { group } from '@imatomix/mix-router'
import { userRoutes } from './routes/users.js'

app.mix(group('/users', userRoutes))
```

group のパスに `:param` や `*` は使えない。
ハンドラの params の型にその値が現れず、型と実際の値がずれてしまうため。

### group の中のコンポーネント

group には普通のコンポーネントも並べられる。プレフィックスの下へのすべてのリクエストで、ルートと並んだ順に実行されるので、認証を先頭に書けば、どのルートにも当たらないパスも含めて領域全体を守れる。

```ts
app.mix(
  group(
    '/admin',
    requireAuth, // /admin、/admin/users、/admin/unknown などで実行される
    adminRoutes,
  ),
)
```

- プレフィックスはルートのパスと同じく、デコードしたうえで区切りごとに比べる（`/admin` は `/administrator` を含まない）
- コンポーネントから見える `ctx.path` は、group からの相対ではなくパス全体
- 順番は `mix()` と同じ意味を持つ。応答したルートより後ろに書いたコンポーネントは実行されない
- 配列は 1 段だけ、順番どおりに展開する。空の配列は何も足さない
- group の中のコンポーネントは `await next()` で後ろを包める。`next()` は group の残りを実行し、そのあとに続くものを実行するので、アプリのその部分だけに効く

```ts
group(
  '/api',
  async (ctx, next) => {
    await next()
    if (ctx.error !== undefined) return Response.json({ error: 'Failed' }, { status: ctx.status })
  },
  apiRoutes,
)
```

## mount

前置きのパスとその下のすべてを、メソッドにかかわらず、アプリ丸ごとに渡す。渡せるのは、独自の `onError` や `bodyLimit` を持つ別の mixer アプリや、ほかのフレームワークで作ったアプリ。mixer アプリには、マウントする場所の絶対パスを `basePath` として渡す。

```ts
import { Mixer } from '@imatomix/mixer'
import { mount } from '@imatomix/mix-router'

const admin = new Mixer({ basePath: '/admin' }).mix(/* ... */)

app.mix(
  mount('/admin', admin), // mixer アプリ
  mount('/legacy', honoApp), // fetch を持つオブジェクト（basePath('/legacy') の Hono アプリなど）
  mount('/api/auth', auth.handler), // fetch 関数
)
```

ルートから自分でアプリを呼ぶと次のものが失われるが、`mount` はこれらを引き継ぐ。

- `ctx.env`（Workers のバインディングなど）
- `waitUntil`。Workers で、マウントしたアプリの応答後の処理が途中で切られない。fetch ハンドラーの処理の失敗は外側のアプリで報告される。mixer アプリは、ほかのエラーと同じく自分で報告する
- クライアントのアドレス。mixer アプリには直接の接続相手を渡すので、直接公開したときと同じく、そのアプリの `trustedProxies` で判断される

気をつけること:

- URL はそのまま渡すので、マウントしたアプリはクライアントが送った URL をそのまま見る。group の中では、`basePath` に group のパスも含める。`group('/v1', mount('/admin', app))` なら `basePath: '/v1/admin'`。`basePath` が違うと `404` になる
- マウントしたアプリは、自分の `404` も含めて、前置きのパスの下のすべてに答える。そのため、`mount` より後ろに mix したものは、それらのパスでは動かない。前に mix したものは、その応答を包む
- `mount` より前でリクエストの本文を読まない。本文は 1 回しか読めず、読まれていた場合は、そのことを伝えるエラーでリクエストが失敗する
- マウントしたアプリの中のエラーには、そのアプリの `onError` が答える。外側のアプリに見えるのは応答だけで、`ctx.error` ではない。`next()` のあとで処理を確定させる外側のコンポーネントは、`ctx.status` も確かめる
- mixer アプリかどうかは `instanceof Mixer` で見分ける。同じ `@imatomix/mixer` から作ったアプリをマウントする

## 独自の State と Env を使う

`createRouter<State>()` で、`ctx.state` に型が付いたルート関数一式を作れる。

```ts
import { createRouter } from '@imatomix/mix-router'

type AppState = { user?: string }

const { get, post, group } = createRouter<AppState>()

const app = new Mixer<AppState>()
app.mix(get('/me', (ctx) => ctx.state.user)) // ctx.state.user: string | undefined
```

`ctx.env` の型（Cloudflare Workers のバインディングなど）は、`Mixer` と同じく 2 つ目の型引数で渡す。省くと `ctx.env` は `unknown` になる。

```ts
type Env = { DATABASE_URL: string }

const { get } = createRouter<AppState, Env>()

const app = new Mixer<AppState, Env>()
app.mix(get('/db', (ctx) => ctx.env.DATABASE_URL)) // ctx.env.DATABASE_URL: string
```

ルートは `mix()` に渡す前に作るので、アプリから型を受け取れない。`createRouter` で一度だけ型を書く。

