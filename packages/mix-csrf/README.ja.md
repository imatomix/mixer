# @imatomix/mix-csrf

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-csrf/README.md) | 日本語

[mixer](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md) の CSRF 対策。ブラウザが付ける `Sec-Fetch-Site` と `Origin` ヘッダーで判断する。トークンもセッションも設定もいらない。

- 動く場所: Node.js・Bun・Cloudflare Workers
- 0.x なので、マイナーバージョンの間で API が変わることがある

## インストール

```sh
npm install @imatomix/mixer @imatomix/mix-csrf
```

## 使い方

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { csrf } from '@imatomix/mix-csrf'
import { post } from '@imatomix/mix-router'

const app = new Mixer()

app.mix(
  csrf(),
  post('/transfer', (ctx) => 'only your own pages can send this'),
)

await serve(app, { port: 3000 })
```

ルーター・セッション・状態を変える処理より**前に** mix する。ブラウザが別のサイトから送ったリクエストは `403` になり、後ろのコンポーネントには届かない。

## オプション

```ts
csrf({
  trustedOrigins: ['https://admin.example.com'],
  allow: (ctx) => ctx.url.pathname.startsWith('/webhooks/'),
})
```

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `trustedOrigins` | なし | リクエストを送ってよい別のオリジン。ブラウザが送る `Origin` と同じ形で書く: `https://admin.example.com` のように、パスや末尾の `/` は付けず、ポートは既定以外のときだけ付ける。ワイルドカードは使えない。それ以外の形は `csrf()` を呼んだ時点で例外になる |
| `allow` | なし | `(ctx) => boolean \| Promise<boolean>`。`true` を返したリクエストは確認しない。他のサービスから届く webhook など |

mix-cors で別のサイトに Cookie 付きの送信を許している（`credentials: true`）なら、そのオリジンを `trustedOrigins` にも並べる。

## 動き

`GET`・`HEAD`・`OPTIONS` は確認しない。それ以外のメソッドは、`Content-Type` に関係なくすべて確認する。

| リクエスト | 結果 |
| --- | --- |
| `Sec-Fetch-Site: same-origin` または `none`（URL の直接入力やブックマーク） | 通す |
| `Sec-Fetch-Site: same-site`・`cross-site`・それ以外の値 | `403`。`Origin` が `trustedOrigins` にあれば通す |
| `Sec-Fetch-Site` が無く、`Origin` のホストとポートがリクエストと同じ | 通す |
| `Sec-Fetch-Site` が無く、それ以外の `Origin`（`null` を含む） | `403`。`trustedOrigins` にあれば通す |
| どちらのヘッダーも無い | ブラウザ以外のクライアント（curl や別のサーバー）として通す |

- `same-site` も拒否するので、同じサイトの別のサブドメインのページからも送れない
- ブラウザ以外のクライアントはどちらのヘッダーも送らない。利用者の Cookie をアプリへ持ち込めないので CSRF の危険はない。CSRF 以上の守りが要るエンドポイントでは、そうしたクライアントを認証する
- 拒否は `HttpError(403)` なので、`onError` やエラー処理からは他のエラーと同じに見える

## 限界

- `GET` と `HEAD` には副作用を持たせない。これらは確認しない
- 2023 年より前のブラウザは `Sec-Fetch-Site` を送らず、その場合は `Origin` のホストだけを比べ、スキームは比べない。サイトは HTTPS だけで提供し（`Strict-Transport-Security` も付ける）、同じホストの `http://` にページが存在しないようにする
- リバースプロキシの後ろでは、プロキシが元の `Host` ヘッダーを渡す必要がある。書き換えると、`Sec-Fetch-Site` を送らないブラウザからのリクエストは `403` になる
- 両方のヘッダーを消すプロキシやプライバシー拡張があると、ブラウザがブラウザ以外のクライアントに見える。それが問題になる操作では、認証済みのトークンやパスワードの再入力も求める

方式は Go の [`http.CrossOriginProtection`](https://pkg.go.dev/net/http#CrossOriginProtection) と [OWASP の Fetch Metadata の指針](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) にならっている。
