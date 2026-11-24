# Mixer

[English](mixer.md) | 日本語

`new Mixer()` のオプション、パスの下に載せること、クライアントのアドレス、アプリの型。

## 型

```ts
type State = { user?: string }
type Env = { DATABASE_URL: string }

const app = new Mixer<State, Env>()
// ctx.state.user: string | undefined、ctx.env.DATABASE_URL: string
```

## クライアントの IP アドレス

`ctx.ip` はクライアントの IP アドレス、`ctx.remoteAddress` は直接の接続元（リバースプロキシなど）の IP アドレス。どちらも正規化され（IPv6 の形の IPv4 は IPv4 になる）、何も渡されなければ `undefined`。`app.fetch` だけでは接続の情報がない。

アダプタは `app.handle(request, options)` でアドレスを渡す。それ以外は `app.fetch` と同じ。

| オプション | どこから来るか | `ctx.ip` |
| --- | --- | --- |
| `remoteAddress` | ソケット。Node.js と Bun のアダプタが `app.handle()` に渡す | 接続元。`trustedProxies` の後ろでは `X-Forwarded-For` から求めたクライアント |
| `clientIp` | 実行環境やフレームワークが確定させたアドレス（Cloudflare の `CF-Connecting-IP`、SvelteKit の `getClientAddress()`） | そのアドレス。`X-Forwarded-For` は読まない |

リバースプロキシの後ろで動かすときは、それを `trustedProxies` に並べる。`X-Forwarded-For` を読むのは、接続元がその一覧に入るときだけ。右から見ていき、信用するプロキシを飛ばして、最初のほかのアドレスをクライアントとするので、クライアントが前に付け足した値は無視される。読む必要のある段が不正なとき、ヘッダが 8 KiB か 32 段を超えるときは、接続元に戻す。

```ts
const app = new Mixer({ trustedProxies: ['10.0.0.0/8', '::1'] })
```

IP アドレスは、プロキシの設定の誤り・NAT・VPN で正しくないことがあり、大勢で 1 つを共有することもある。ログやレート制限に使い、それだけで相手が誰かを決めない。

## basePath

```ts
const app = new Mixer({ basePath: '/api' })
// GET /api/users → ctx.path === '/users'。/api の外へのリクエストは 404
```

`ctx.url` は URL 全体のまま。モジュールは `ctx.path` で照合するので、`basePath` の下でもそのまま動く。

## オプション

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `basePath` | なし | アプリを置くパス |
| `bodyLimit` | 3 MB | `ctx.json()`・`ctx.form()`・`ctx.text()`・`ctx.bytes()` が読むボディの上限。超えると `413`。読むときに `bodyLimit` を渡せば、そのルートだけ変えられる（[詳細](../how-to/request-body.ja.md#リクエストボディ)） |
| `onError` | なし | エラーの応答を組み立てる `(error, ctx) => value` |
| `trustedProxies` | なし | `ctx.ip` のために `X-Forwarded-For` を読む、リバースプロキシ（IP アドレスか CIDR の範囲） |
