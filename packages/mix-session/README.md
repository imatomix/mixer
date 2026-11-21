# @imatomix/mix-session

Server-side sessions for [mixer](../mixer).

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-session
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { type SessionState, session } from '@imatomix/mix-session'
import { get, post } from '@imatomix/mix-router'

type Data = { user: string }

const app = new Mixer<SessionState<Data>>()

app.mix(
  session<Data>(),
  post('/login', async (ctx) => {
    // ...認証に成功したら
    ctx.state.session.regenerate() // ログイン時は必ず ID を作り直す
    ctx.state.session.set('user', 'imatomix')
    return 'ok'
  }),
  get('/me', (ctx) => ctx.state.session.get('user') ?? null),
  post('/logout', (ctx) => {
    ctx.state.session.destroy()
    return 'bye'
  }),
)
```

## 仕組み

- Cookie には **32 バイトの乱数の ID だけ**を入れ、データはサーバ側のストアに置く。データがブラウザに渡らないので暗号化はしていない
- **書き込むまでセッションを作らない**。訪問しただけではストアにも Cookie にも何も作られない
- 変更があったときだけ、応答の直前（`ctx.onBeforeSend`）にストアへ保存し Cookie を発行する
- Set-Cookie を出す応答は `Cache-Control: private, no-store` にする（共有キャッシュから他の利用者に同じセッションが配られないように）
- `ctx.res` に直接書き込んで応答した場合は保存されない。`return` か `ctx.send()` で応答すること

## API

`ctx.state.session`（`Session`）

| メソッド | 説明 |
| --- | --- |
| `get(key)` / `set(key, value)` / `delete(key)` | データの読み書き。すべてのキーを消すと `destroy()` と同じ |
| `regenerate()` | データを保ったまま ID を作り直し、古い ID をストアから消す。**ログインなど権限が変わるときに必ず呼ぶ**（セッション固定化の対策） |
| `destroy()` | ストアから消し、Cookie も削除する |
| `id` | 読み込んだセッションの ID。新しいセッションでは保存されるまで `undefined` |

## Options

| オプション | 初期値 | 説明 |
| --- | --- | --- |
| `store` | `new MemoryStore()` | 保存先 |
| `name` | `'sid'` | Cookie の名前 |
| `ttl` | `86400` | 有効期間（秒）。Cookie の Max-Age とストアの期限に使う |
| `rolling` | `false` | 読むだけのリクエストでも期限を延ばす |
| `cookie` | mixer の既定（HttpOnly・Secure・SameSite=Lax・Path=/） | Cookie の属性。http の localhost で開発するときは `{ secure: false }` |

## ストア

```ts
interface SessionStore {
  get(id: string): Promise<SessionData | undefined>
  set(id: string, data: SessionData, ttlSeconds: number): Promise<void>
  /** 存在するときだけ更新し、なければ false。確認と更新は不可分に行うこと */
  update(id: string, data: SessionData, ttlSeconds: number): Promise<boolean>
  delete(id: string): Promise<void>
}
```

`update` が「存在するときだけ」なのは、`destroy()` や `regenerate()` された直後に、古い ID を持った並行リクエストの保存でセッションが復活するのを防ぐため。

`MemoryStore` はプロセス内のメモリに保存する。有効期限を過ぎたものは返さず、`maxEntries`（既定 10000）を超えたら最も長く使われていないものから捨てる。
複数プロセスで動かす場合や、再起動でセッションを失いたくない場合は、外部のストアを実装して渡す。

## 不正な ID の扱い

- ストアにない ID（期限切れ・偽造）は採用せず、書き込み時に新しい ID を発行する
- 形式が不正な ID や、同じ名前の Cookie が複数ある場合（サブドメインなどから仕込まれた可能性）は読み込まない

## v0.0.x からの移行

v0.0.x は Node.js 22 で削除された `crypto.createCipher` を使っており、現在の Node.js では動作しない。設計から作り直したので、API は互換性がない。

| v0.0.x | v0.1 |
| --- | --- |
| `req.session.user = 'x'` | `ctx.state.session.set('user', 'x')` |
| `secret`（データを暗号化） | 不要（データはサーバ側にのみある） |
| `generateId` | 廃止（32 バイトの乱数で固定） |
| `cookie.httpOnly`（常に true になっていた） | `cookie.httpOnly`（既定 true、false も指定可能） |
| 全訪問者にセッションを作成 | 書き込んだときだけ作成 |
