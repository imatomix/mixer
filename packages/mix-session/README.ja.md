# @imatomix/mix-session

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-session/README.md) | 日本語

[mixer](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md) のサーバサイドセッション。Cookie にはランダムな ID だけを入れ、書き込むまで何も作らない。

- 動く場所: Node.js・Bun・Cloudflare Workers（Workers などのサーバーレス環境では外部のストアを使う）
- 0.x なので、マイナーバージョンの間で API が変わることがある

## インストール

```sh
npm install @imatomix/mixer @imatomix/mix-session
```

## 使い方

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
- 変更があったときだけ、アプリの残りが動いたあと（`await next()`）にストアへ保存し Cookie を発行する。`session.get('cart').push(item)` のように値の中を変えた場合も変更として扱う。`session()` は、それを使うコンポーネントより前、キャッシュさせたいものより後に mix する
- セッションのあるリクエスト（読み込んだか、応答がその Cookie を設定・削除する）への応答はすべて `Cache-Control: private, no-store` にし、ほかの値は置き換える。エラーの応答や返した `Response` も同じ。そうしたページは 1 人の利用者のデータを見せるので、どのキャッシュにも残さず、うっかり `public` にしても他の人に配られない。静的ファイルなどキャッシュさせたいものは、`session()` より**前に** mix する。保存に失敗したときのエラーの応答にも、`onError` が自分のページを返した場合も含め、同じ指定を付ける
- コンポーネントが返した `Response`、`404`、エラーの応答を含め、すべての応答で保存する
- セッション ID は Web Crypto（`crypto.getRandomValues`）で作る

## API

`ctx.state.session`（`Session`）

| メソッド | 説明 |
| --- | --- |
| `get(key)` / `set(key, value)` / `delete(key)` | データの読み書き。すべてのキーを消すと `destroy()` と同じ |
| `regenerate()` | データを保ったまま ID を作り直し、古い ID をストアから消す。**ログインなど権限が変わるときに必ず呼ぶ**（セッション固定化の対策）。`absoluteTtl` も数え直す |
| `destroy()` | ストアから消し、Cookie も削除する |
| `id` | 読み込んだセッションの ID。新しいセッションでは保存されるまで `undefined` |

## オプション

| オプション | 初期値 | 説明 |
| --- | --- | --- |
| `store` | `new MemoryStore()` | 保存先 |
| `name` | `'__Host-sid'`（[後述](#cookie-の名前)） | Cookie の名前 |
| `ttl` | `86400` | 保存し直されないまま生きる秒数。Cookie の Max-Age とストアの期限に使う |
| `rolling` | `false` | 読むだけのリクエストでも期限を延ばす |
| `absoluteTtl` | `604800`（7 日） | 使われ続けていても、この秒数でセッションを終える。セッションを作ったときと作り直したとき（ログインなど）に数え直す。`false` で無効 |
| `cookie` | mixer の既定（HttpOnly・Secure・SameSite=Lax・Path=/） | Cookie の属性。http の localhost で開発するときは `{ secure: false }` |
| `cacheControl` | `'private, no-store'` | セッションのある応答の Cache-Control。別の指定は 引数なしの `private` か `no-store`（`=...` を付けない）を含み、`public` を含まないこと（`'private, max-age=60'` など）。`false` ならキャッシュはアプリに任せる |

## ストア

ストアが受け取る値は、mix-session が保存する `{ createdAt, data }`（`absoluteTtl` のためのセッションの作成時刻と、セッションのデータ）。ほかの形の値は採用しない。

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

複数プロセスで動かす場合や、再起動でセッションを失いたくない場合は、外部のストアを実装して渡す。リクエストごとに別のインスタンスで動きうるサーバーレス環境や Cloudflare Workers では、必ず外部のストアを使う。その `update` は、存在の確認と更新を一度に行う必要がある（D1 のトランザクションや Durable Object など）。Workers KV は書き込みがほかの拠点に届くまで時間がかかるので向かない。

### Redis

`@imatomix/mix-session/redis` の `redisStore()` は、セッションを Redis に保存する。依存はなく、使っているクライアントで 1 つのコマンドを送り、その応答を返す `send` 関数を渡す。

```ts
import { session } from '@imatomix/mix-session'
import { redisStore } from '@imatomix/mix-session/redis'

app.mix(session({ store: redisStore({ send: (args) => client.sendCommand(args) }) }))
```

| クライアント | `send` |
| --- | --- |
| node-redis | `(args) => client.sendCommand(args)` |
| ioredis | `([command, ...rest]) => client.call(command, ...rest)` |
| Bun | `([command, ...rest]) => client.send(command, rest)` |

```ts
// Upstash の REST（Workers 向け）
const send = async (args: string[]) => {
  const res = await fetch(env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
    body: JSON.stringify(args),
  })
  const { result, error } = await res.json()
  if (error) throw new Error(error)
  return result
}
```

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `send` | 必須 | 1 つのコマンドを送り、その応答を返す。Redis のエラーは例外にする |
| `prefix` | `'mix-session:'` | すべてのキーの先頭に付ける |
| `hashKeys` | `true` | セッション ID の SHA-256 ハッシュ値をキーにする |

- **既定では、キーはセッション ID のハッシュ値。** セッション ID はそれだけでセッションを使える値なので、そのままキーにすると、キーの一覧・監視ツール・ログ・バックアップに出たキーから乗っ取れてしまう。`hashKeys: false` は、同じキーを読むほかのソフトウェアとセッションを共有するときだけに使い、その場合は Redis を外から触らせないこと（ネットワーク・ACL・TLS）に頼る
- `sessionKey(id, { prefix, hashKeys })` で、セッション ID に対応するキーを求められる（手で調べるとき用）
- `update` は `SET ... XX` を使うので、途中で破棄されたセッションや期限切れのセッションを書き戻さない
- `checkSessionStore()` を満たし、CI で本物の Redis に対して確かめている

### 自作のストアを確かめる

`@imatomix/mix-session/testing` の `checkSessionStore()` は、上の決まりをストアに対して確かめ、最初に破った決まりの名前を付けた `Error` を投げる。テストの道具に依存せず、毎回新しいランダムな ID を使うので、Redis のような共有のストアも確かめられる。

```ts
import { checkSessionStore } from '@imatomix/mix-session/testing'

it('セッションのストアの決まりを守る', async () => {
  await checkSessionStore(() => myStore()) // 約 2 秒かかる有効期限の確認を飛ばすなら { expiry: false }
})
```

## Cookie の名前

既定では、オプションが許す範囲で最も強い接頭辞を名前に付ける。攻撃者がほかのサブドメインや http のページから、自分の選んだセッション ID を植え付けられないようにするため。

| オプション | 既定の名前 | Cookie を上書きできない相手 |
| --- | --- | --- |
| 既定のまま | `__Host-sid` | ほかのサブドメインと http のページ |
| `cookie: { domain: 'example.com' }`（サブドメインで共有）、または `/` 以外の `path` | `__Secure-sid` | http のページ |
| `cookie: { secure: false }`（http での開発） | `sid` | なし。開発のときだけに使う |

サブドメインでセッションを共有したいときは、`domain` を指定するだけでよい。`name` を渡せばその名前をそのまま使い、ブラウザが拒否する組み合わせ（`domain` 付きの `__Host-` など）は、`session()` を呼んだ時点で例外を投げる。

## 不正な ID の扱い

- ストアにない ID（期限切れ・偽造）は採用せず、書き込み時に新しい ID を発行する
- 形式が不正な ID や、同じ名前の Cookie が複数ある場合（サブドメインなどから仕込まれた可能性）は読み込まない

