# @imatomix/mix-router

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-router/README.md) | 日本語

Type-safe router for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer).

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-router
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { all, get } from '@imatomix/mix-router'

const app = new Mixer()

app.mix(
  get('/mix/:fruit', (ctx, { fruit }) => `${fruit} juice`),
  all('/*', (ctx) => ctx.send(404, 'Not found route')),
)

await app.listen(3000)
```

ルートは mixer の Component なので、そのまま `mix()` に渡せる。
パスとメソッドが一致しなければ何もせず、次のコンポーネントへ進む。

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
  if (!ctx.req.headers.authorization) throw new HttpError(401, 'Unauthorized')
}

get('/admin/users/:id', requireAuth, (ctx, { id }) => findUser(id))
```

## namespace

ルートの先頭に共通のパスを付ける。入れ子にもできる。

```ts
import { get, namespace } from '@imatomix/mix-router'

const api = namespace('/api')
const v1 = namespace('/v1')

app.mix(
  api(
    v1(get('/', () => 'API V1')), // GET /api/v1
    get('/health', () => 'ok'), // GET /api/health
  ),
)
```

namespace のパスに `:param` や `*` は使えない。
ハンドラの params の型にその値が現れず、型と実際の値がずれてしまうため。

## 独自の State を使う

`createRouter<State>()` で、`ctx.state` に型が付いたルート関数一式を作れる。

```ts
import { createRouter } from '@imatomix/mix-router'

type AppState = { user?: string }

const { get, post, namespace } = createRouter<AppState>()

const app = new Mixer<AppState>()
app.mix(get('/me', (ctx) => ctx.state.user)) // ctx.state.user: string | undefined
```

## v0.0.x からの移行

| v0.0.x | v0.1 |
| --- | --- |
| `const { get } = require('mix-router')` | `import { get } from '@imatomix/mix-router'` |
| `get(path, (req, res) => {})` | `get(path, (ctx, params) => {})` |
| `req.params.fruit` | 第2引数の `params.fruit` |
| `req.query.q` | `ctx.url.searchParams.get('q')` |
| `namespace(prefix)(...routes)` | 同じ（入れ子でもパスが正しく連結されるようになった） |
| `mkcalendar()` などのその他のメソッド | `route('MKCALENDAR', path, handler)` |
| `res.post(200, x)` | `return x` または `ctx.send(200, x)` |
