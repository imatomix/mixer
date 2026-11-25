# SPA と組み合わせる

[English](spa.md) | 日本語

ファイルとしてビルドした React（Vue、Svelte なども同じ）のアプリと、その API を、1 つの mixer のアプリから配る。オリジンが 1 つなので、Cookie と CSRF 対策がそのまま使え、CORS も要らない。

| URL | 答えるもの |
| --- | --- |
| `/api/...` | API のルート。知らないパスには JSON の `404` |
| `/assets/app.3f9a1c.js`、`/logo.svg` など | mix-static で配るビルドの出力 |
| `/`、`/todos/3` などそれ以外の画面 | `index.html`。アプリ自身のルーターが画面を出す |

```ts
// examples/docs/src/spa.ts
import { join } from 'node:path'
import { csrf } from '@imatomix/mix-csrf'
import { get, group } from '@imatomix/mix-router'
import { secureHeaders } from '@imatomix/mix-secure-headers'
import { serveFile, serveStatic } from '@imatomix/mix-static'
import { type Component, HttpError, Mixer } from '@imatomix/mixer'

const apiRoutes = [get('/hello', () => ({ message: 'Hello from mixer' }))]

/** dist は React アプリのビルドの出力（Vite の dist/ など） */
export function createApp(dist: string) {
  const indexPage = serveFile(join(dist, 'index.html'))

  // React アプリの画面: API のルートにもファイルにも当たらなかった、ブラウザからの GET
  const reactPages: Component = (ctx, next) => {
    const accept = ctx.request.headers.get('accept') ?? ''
    if (ctx.method === 'GET' && accept.includes('text/html')) {
      return indexPage(ctx, next)
    }
  }

  return new Mixer().mix(
    secureHeaders({ csp: { 'default-src': ["'self'"] } }),
    csrf(),
    group('/api', apiRoutes, () => {
      throw new HttpError(404)
    }),
    // ハッシュ付きの名前は中身が変わると変わるので、1 年キャッシュしてよい
    serveStatic(join(dist, 'assets'), {
      prefix: '/assets',
      maxAge: 31_536_000,
      immutable: true,
    }),
    serveStatic(dist),
    reactPages,
  )
}
```

- **動くかどうかは順番で決まる。** API を最初に置き、最後に `404` を投げるので、打ち間違えた API のパスは、アプリが読めるエラーになり、画面にはならない。次にファイル。画面は最後で、ブラウザからの `GET`（`Accept: text/html`）のときだけ返すので、見つからないスクリプトには、ブラウザが実行しようとする HTML ではなく `404` を返す
- `assets/` の下のファイルは名前に中身のハッシュが入っているので、`immutable` を付けて 1 年キャッシュする。`index.html` は `max-age=0` と ETag 付きで送るので、ブラウザは毎回新しいビルドがないかを確かめ、変わっていなければ `304` を受け取る
- アプリからは `fetch('/api/hello')` のような相対 URL で API を呼ぶ。ブラウザはセッションの Cookie と `Sec-Fetch-Site: same-origin` を送り、`csrf()` はそれを通す
- CSP の `default-src 'self'` は、スクリプトとスタイルが同じオリジンのファイルになるビルド済みのアプリに合う。ほかから読み込むものだけを足す

## 開発中

mixer とフロントの開発サーバーを並べて動かし、開発サーバーから API のリクエストを mixer に渡す。Vite なら:

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:3000' } },
})
```

## 別のオリジンのフロント

フロントをほかの場所（CDN やホスティングサービス）で配り、mixer は API だけを配るときは、オリジンが分かれる。フロントのオリジンを指定した [mix-cors](../../packages/mix-cors) を足す。Cookie を使うなら、さらに mix-cors で `credentials: true` にし、フロントでは `fetch(url, { credentials: 'include' })` で呼び、`csrf({ trustedOrigins })` にフロントのオリジンを入れる。フロントがサブドメインではなく別のサイトにあるなら、ブラウザがセッションの Cookie を送るのは `SameSite=None` のときだけ（mix-session の `cookie: { sameSite: 'None' }`）。上のようにオリジンを 1 つにすれば、これらはすべて要らない。

## Cloudflare Workers では

ビルドの出力は mix-static ではなく Workers Static Assets で配る。`not_found_handling = "single-page-application"` で画面に `index.html` を返し、`run_worker_first = ["/api/*"]` で API のリクエストを先に mixer へ回す。Cloudflare の [single-page application](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) の案内を参照。

このとき、画面とファイルへのリクエストには mixer を通さずに Cloudflare が答えるので、`secureHeaders()` は動かない。ビルドの出力に [`_headers`](https://developers.cloudflare.com/workers/static-assets/headers/) ファイルを置いて、同じヘッダーを付ける（Vite は `public/_headers` を `dist/` に写す）。

```text
/*
  Content-Security-Policy: default-src 'self'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
```

コードとテストは [examples/docs](../../examples/docs) にある。関連: [アプリを動かす](runtimes.ja.md)、[mix-static](../../packages/mix-static/README.ja.md)、[mix-csrf](../../packages/mix-csrf/README.ja.md)
