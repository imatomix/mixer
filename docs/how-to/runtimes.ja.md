# アプリを動かす

[English](runtimes.md) | 日本語

`app.fetch` はただの `(request, env?, executionContext?) => Promise<Response>` なので、どこで動かす場合も、リクエストをこれに渡すだけ。

## Node.js

```ts
import { serve } from '@imatomix/mixer/node'

const server = await serve(app, { port: 3000 })
server.port // 使っているポート（port: 0 なら空いているポート）
await server.close()
```

`serve()` は、指定しなければ `127.0.0.1` で待ち受け、ローカルのホスト名だけを受け付ける（[理由](../../packages/mixer/README.ja.md#何もしなくても安全)）。ドメインで公開するときや、コンテナなどほかのマシンから使うときは明示する。

```ts
await serve(app, {
  port: 3000,
  hostname: '0.0.0.0', // ほかのマシンからの接続も受け付ける
  allowedHosts: ['example.com', 'www.example.com'],
})
```

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `port` | `0`（空いているポート） | |
| `hostname` | `'127.0.0.1'` | 待ち受けるアドレス |
| `allowedHosts` | なし | `localhost`・`*.localhost`・`127.0.0.1`・`[::1]`・`hostname` に渡した IP アドレスのほかに受け付けるホスト名。完全一致で、大文字小文字とポートは無視する。`true` はどの名前も受け付ける。手前でホスト名を確かめている場合だけに使う |

- ほかのホスト名へのリクエストは本文なしの `400` になってアプリに届かない。最初の 1 回だけ `console.warn` に出る
- `Host` がない、複数ある、単純なホスト名とポート以外のものは `400` になる
- `X-Forwarded-For` は `trustedProxies` のときだけ読む（[クライアントの IP アドレス](../../packages/mixer/README.ja.md#クライアントの-ip-アドレス)）。`X-Forwarded-Proto` と `X-Forwarded-Host` は使わない
- コンポーネントがリクエストボディを読まなかったとき（`413` のあとなど）は、残りを読まずに接続を閉じる
- クライアントが切断すると `ctx.request.signal` が中断され、ストリーミング中の本文も止まる
- 送るのが遅いクライアントは、Node 自身の上限で切られる。ヘッダーは 60 秒、リクエスト全体は 300 秒。効くのは受信の間だけで、遅いハンドラーやストリームで返す応答には効かない（[時間のかかる処理](streaming-and-background-work.ja.md#時間のかかる処理)）
- `server.close()` は新しい接続の受け付けを止め、待機中の接続を閉じ、接続ごとに、処理中のリクエストに応答し終えたら閉じる。`timeout`（既定 10 秒。`server.close({ timeout: 30_000 })`）を過ぎたら残りを切り、その `ctx.request.signal` を中断する。`SIGTERM` を受けたときに呼べば、リクエストを落とさずに入れ替えられる

## Bun

```ts
import { serve } from '@imatomix/mixer/bun'

const server = await serve(app, { port: 3000 })
// 終了するとき:
await server.close()
```

Node.js アダプタと同様、既定では `127.0.0.1` で待ち受け、知らない Host 名は 400 で拒否する。オプションは `hostname`・`port`（既定は `0`、空いているポート）・`allowedHosts` のみで、意味は上と同じ。`server.requestIP(request)` を `app.handle()` に渡して `ctx.ip` に使い、Bun のサーバーを `ctx.env` に入れない。`server.close()` は処理中のリクエストが終わるまで待つ。終了のタイムアウト指定はない。ハンドラーが例外を投げたり Promise が失敗したりした場合は、開発モードでもサーバー側にエラーを記録し、本文のない 500 応答を返す。Bun は、何も送らない時間が 10 秒続いた接続を閉じる（既定の `idleTimeout`）。応答するまでにそれより長くかかるハンドラーや、それだけ止まるストリームは切られる。

## Cloudflare Workers

```ts
type Env = { DATABASE_URL: string }

const app = new Mixer<Record<string, unknown>, Env>().mix((ctx) => ctx.env.DATABASE_URL)

export default app satisfies ExportedHandler<Env>
```

`ctx.ip` には、Cloudflare が確定させたアドレスを渡す。mixer は `CF-Connecting-IP` を自分では読まない。Cloudflare の外では誰でもこのヘッダを送れるため。

```ts
export default {
  fetch: (request, env, executionContext) =>
    app.handle(request, {
      env,
      executionContext,
      clientIp: request.headers.get('cf-connecting-ip') ?? undefined,
    }),
} satisfies ExportedHandler<Env>
```

- `ctx.env` には Worker のバインディングが入り、`ctx.waitUntil()` は Worker の `ctx.waitUntil` に渡される。mix-router を使うときは、`createRouter<State, Env>()` にもバインディングの型を渡す
- PR ごとに、workerd の互換日付 `2026-07-30`、Node 互換を切った状態（`no_nodejs_compat`、`no_nodejs_compat_v2`）で動作を確かめ、`@cloudflare/workers-types` で型も確かめている。mixer に `nodejs_compat` は要らない
- クライアントが切断したときに `ctx.request.signal` が中断されるのは、互換日付 `2026-11-17` 以降か、それより前で `enable_request_signal` フラグを付けたときだけ
- `bodyLimit` が効くのは `ctx.json()`・`ctx.form()`・`ctx.text()`・`ctx.bytes()` で読んだときだけで、`ctx.request` を直接読むと効かない。`ctx.waitUntil()` に渡した処理には Workers の時間の上限がかかる

| パッケージ | Workers での扱い |
| --- | --- |
| mixer、mix-router、mix-cors、mix-csrf、mix-secure-headers、mix-logger | 対応 |
| mix-session | 外部のストアを使えば対応（`MemoryStore` は 1 つの isolate の中にしかない） |
| mix-static | 非対応（ファイルシステムがない）。Workers Static Assets を使う |
| `@imatomix/mixer/node` | 使わない |

## フレームワークの中で使う

フレームワークのキャッチオールのルートに mixer を置き、そのルートのパスを `basePath` に設定して、`Request` だけを渡す。フレームワークはハンドラにほかの引数も渡すので、そのまま渡すと `ctx.env` に入ってしまう。`ctx.ip` には、SvelteKit の `getClientAddress()` のようなフレームワークのアドレスの取り方を使い、`app.handle(request, { clientIp })` で渡す。

**Next.js**（App Router）、`app/api/[[...path]]/route.ts`:

```ts
const app = new Mixer({ basePath: '/api' }).mix(/* ... */)
const handler = (request: Request) => app.fetch(request)

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE }
```

**Nuxt**（Nuxt 4、h3 v1）、`server/api/[...path].ts`（h3 v2 では `event.req` を渡す）:

```ts
const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export default defineEventHandler((event) => app.fetch(toWebRequest(event)))
```

**SvelteKit**、`src/routes/api/[...path]/+server.ts`:

```ts
import type { RequestHandler } from './$types'

const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export const fallback: RequestHandler = ({ request }) => app.fetch(request)
```

**React Router**（v7、フレームワークモード）、`app/routes/api.$.ts` などのリソースルート:

```ts
import type { Route } from './+types/api.$'

const app = new Mixer({ basePath: '/api' }).mix(/* ... */)

export const loader = ({ request }: Route.LoaderArgs) => app.fetch(request)
export const action = ({ request }: Route.ActionArgs) => app.fetch(request)
```
