# mixer

Minimal & asynchronous web module.

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

- TypeScript 製・ESM のみ・依存ゼロ
- Node.js 20 以上

## Install

```sh
npm install @imatomix/mixer
```

## Usage

リクエストを受け取ったときに実行する関数（コンポーネント）を `mix()` で足していく。
コンポーネントは `ctx` を 1 つ受け取り、値を返すとそれがレスポンスになる。

```ts
import { Mixer } from '@imatomix/mixer'

const app = new Mixer()

app.mix(() => 'Hello Mixer')

await app.listen(3000)
```

### mix()

関数は個別に `mix()` で繋げてもいいし、一つの `mix()` に複数入れてもいい。

```ts
app.mix(fn).mix(fn).mix(fn)
app.mix(fn, fn, fn)
```

先に `mix()` した順に実行され、**値を返した（`undefined` 以外）ところで止まる**。
何も返さなければ次のコンポーネントへ進み、最後まで誰も応答しなければ `404` になる。

### ctx

| プロパティ | 説明 |
| --- | --- |
| `ctx.req` / `ctx.res` | Node.js 標準の `IncomingMessage` / `ServerResponse`（mixer は何も書き足さない） |
| `ctx.url` | リクエスト URL の `URL` オブジェクト（`ctx.url.pathname`, `ctx.url.searchParams`） |
| `ctx.method` | HTTP メソッド |
| `ctx.status` | 戻り値で応答するときのステータスコード（デフォルト `200`） |
| `ctx.state` | 後続のコンポーネントに値を渡すための入れ物 |
| `await ctx.body()` | Content-Type に応じて解析したボディ |
| `await ctx.text()` / `await ctx.buffer()` | ボディを文字列 / Buffer で取得 |
| `ctx.send(status, body?)` | その場でレスポンスを返す |

### レスポンス

戻り値（または `ctx.send()` の `body`）の型で自動的に形式が決まる。
`Content-Type` を先に `ctx.res.setHeader()` で設定しておけばそちらが優先される。

| 値 | レスポンス |
| --- | --- |
| `string` | `text/plain; charset=utf-8` |
| `Buffer` / `Uint8Array` | `application/octet-stream` |
| `Readable` ストリーム | そのまま流す（`application/octet-stream`） |
| オブジェクト・数値・真偽値 | JSON（`application/json; charset=utf-8`） |
| `null` | `204 No Content` |

```ts
app.mix((ctx) => {
  ctx.status = 201
  return { created: true }
})
```

### リクエストボディ

`ctx.body()` は必要になったときだけボディを読む。何度呼んでも同じ結果を返す。

| Content-Type | 結果 |
| --- | --- |
| `application/json`, `*+json` | `JSON.parse` した値（不正なら `400`） |
| `application/x-www-form-urlencoded` | `{ key: value }`（重複キーは配列） |
| `text/*` またはなし | 文字列 |
| その他 | `Buffer` |
| ボディが空 | `undefined` |

上限（デフォルト 3MB）を超えると `413` になる。

```ts
const app = new Mixer({ bodyLimit: 1024 * 1024 })
```

### ctx.state と型

```ts
type State = { user?: string }

const app = new Mixer<State>()

app
  .mix((ctx) => {
    ctx.state.user = 'imatomix'
  })
  .mix((ctx) => `hello ${ctx.state.user}`)
```

### エラー処理

`HttpError` を投げるとそのステータスで `{ "error": message }` を返す。
それ以外の例外は `500` になり、詳細はクライアントに見せずに `console.error` に出す。

```ts
import { HttpError, Mixer } from '@imatomix/mixer'

app.mix((ctx) => {
  if (!ctx.state.user) throw new HttpError(401, 'Unauthorized')
})
```

`onError` でエラーレスポンスを差し替えられる。

```ts
const app = new Mixer({
  onError: (error, ctx) => ctx.send(500, { message: 'ごめんなさい' }),
})
```

### サーバ

```ts
const server = await app.listen(3000) // http.Server を返す
app.address // => { port: 3000, ... }
await app.close()
```

`app.handler` は `(req, res) => Promise<void>` なので、自前の `http` / `https` サーバにも渡せる。

```ts
import { createServer } from 'node:https'

createServer({ key, cert }, app.handler).listen(443)
```

# Examples

### async/await

```ts
import { setTimeout as sleep } from 'node:timers/promises'
import { Mixer } from '@imatomix/mixer'

const app = new Mixer().mix(async () => {
  await sleep(3000)
  return 'Good Morning Mixer'
})

await app.listen(3000)
```

### Nuxt.js などの (req, res) ハンドラ

mixer は `req` / `res` を書き換えないので、そのまま渡せる。

```ts
app.mix((ctx) => nuxt.render(ctx.req, ctx.res))
```

## v0.0.x からの移行

| v0.0.x | v0.1 |
| --- | --- |
| `require('mixer')` | `import { Mixer } from '@imatomix/mixer'` |
| `new mixer(fn)` | `new Mixer().mix(fn)` |
| `(req, res) => {}` | `(ctx) => {}`（`ctx.req`, `ctx.res`） |
| `req.body` | `await ctx.body()` |
| `res.send(code, obj)` | `ctx.send(code, obj)` または `ctx.status = code; return obj` |
| `delete res.send`（Nuxt.js 用） | 不要 |

## Development

```sh
npm test          # vitest
npm run typecheck # tsc
npm run lint      # biome
npm run build     # tsup + 型定義
```

## mix modules

※ 以下は v0.0.x の `(req, res)` 形式のため、v0.1 では未対応。

- [mix-router](https://github.com/imatomix/mix-router) : ルーティング機能
- [mix-static](https://github.com/imatomix/mix-static) : 静的ファイルのサーブ
- [mix-logger](https://github.com/imatomix/mix-logger) : logger
- [mix-favicon](https://github.com/imatomix/mix-favicon) : faviconのサーブ
- [mix-cors](https://github.com/imatomix/mix-cors) : cors処理
