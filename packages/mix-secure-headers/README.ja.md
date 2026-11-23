# @imatomix/mix-secure-headers

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-secure-headers/README.md) | 日本語

[mixer](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md) のセキュリティヘッダー。既定値はページを壊さないものだけにし、それ以外はオプション 1 つで付けられる。

- 動く場所: Node.js・Bun・Cloudflare Workers
- 0.x なので、マイナーバージョンの間で API が変わることがある

## インストール

```sh
npm install @imatomix/mixer @imatomix/mix-secure-headers
```

## 使い方

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { secureHeaders } from '@imatomix/mix-secure-headers'

const app = new Mixer()

app.mix(secureHeaders(), () => 'secure headers are mixed!')

await serve(app, { port: 3000 })
```

`404` やエラーを含むすべての応答に付くよう、**最初に** mix する。`X-Content-Type-Options: nosniff` は mixer 本体がすでに付けている。

## オプション

```ts
secureHeaders({
  frameOptions: 'SAMEORIGIN',
  hsts: true,
  csp: {
    'default-src': ["'self'"],
    'img-src': ["'self'", 'https://img.example.com'],
    'upgrade-insecure-requests': [],
  },
})
```

| オプション | ヘッダー | 既定値 | 値 |
| --- | --- | --- | --- |
| `frameOptions` | `X-Frame-Options` | `'DENY'` | `'DENY'`・`'SAMEORIGIN'`・`false` |
| `referrerPolicy` | `Referrer-Policy` | `'strict-origin-when-cross-origin'` | リファラーポリシーの値・`false` |
| `hsts` | `Strict-Transport-Security` | なし | `true`（1 年、`max-age=31536000`）・`{ maxAge, includeSubDomains?, preload? }`・`false` |
| `csp` | `Content-Security-Policy` | なし | ディレクティブ（`{ 'default-src': ["'self'"] }`、1 項目に 1 ソース）か、ヘッダーの値全体の文字列 |
| `crossOriginOpenerPolicy` | `Cross-Origin-Opener-Policy` | なし | `'same-origin'`・`'same-origin-allow-popups'`・`'noopener-allow-popups'`・`'unsafe-none'` |
| `crossOriginResourcePolicy` | `Cross-Origin-Resource-Policy` | なし | `'same-origin'`・`'same-site'`・`'cross-origin'` |
| `permissionsPolicy` | `Permissions-Policy` | なし | ヘッダーの値全体。`'camera=(), geolocation=(self)'` など |

不正な値は `secureHeaders()` を呼んだ時点で例外になる。空白・`;`・`,` を含む CSP のソースも、書いていないディレクティブを足してしまうので例外にする。

### 既定で付けないヘッダーがある理由

- **`hsts`**: ブラウザは `maxAge` のあいだ覚えていて、HTTP からは取り消せない。HTTPS でだけ送るものでもある。TLS をプロキシが処理していると、ブラウザが HTTPS を使ったかを mixer からは判断できない。HTTPS だけで提供するサイトで有効にするか、TLS を処理するプロキシや CDN で付ける。`preload` には `includeSubDomains` と 1 年以上の `maxAge` が必要
- **`csp`**: ポリシーは、アプリごとに読み込むスクリプト・スタイル・画像で決まる
- **`crossOriginOpenerPolicy`**: `same-origin` は、開いたページとやり取りするログインや決済のポップアップを壊す
- **`crossOriginResourcePolicy`**: 他のサイトから画像やファイルを読み込めなくなる
- **`Referrer-Policy: no-referrer`** を既定にしないのは、サイト自身のフォーム送信でもブラウザが `Origin: null` を送るようになり、mix-csrf などの `Origin` の確認を壊すため

今のブラウザで効果のないヘッダー（`X-XSS-Protection`・`X-DNS-Prefetch-Control`・`X-Download-Options`・`X-Permitted-Cross-Domain-Policies`）は送らない。

## ルートごとに変える

後ろのコンポーネントがすでに設定したヘッダーや、返した `Response` が持っているヘッダーは、そのまま残る。

```ts
get('/embed', (ctx) => {
  ctx.headers.set('X-Frame-Options', 'SAMEORIGIN')
  return page
})
```

あるルートでヘッダーを外すには、mixer の `ctx.onResponseHeaders` で消す。リスナーは追加した順に動くので、`secureHeaders()` のあとに動く。

```ts
get('/widget', (ctx) => {
  ctx.onResponseHeaders((headers) => headers.delete('X-Frame-Options'))
  return widget
})
```

## ヘッダーの付け方

`secureHeaders()` は mixer の [`ctx.onResponseHeaders`](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md#フック) を使うので、応答の組み立てが失敗したときの `500` を含め、実際に送る応答にヘッダーが付く。付かないのは、どのコンポーネントも動く前に応答する、`basePath` の外へのリクエストへの `404` だけ。
