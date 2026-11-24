# @imatomix/mix-compress

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-compress/README.md) | 日本語

[mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer) の応答を圧縮する。Node.js や Bun で直接公開するアプリ向け。

- Node.js と Bun で動く。Cloudflare Workers や、圧縮する CDN・プロキシ（nginx、Caddy、多くのホスティング）の後ろでは要らない
- 0.x のため、マイナーバージョンの間で API が変わることがある

## インストール

```sh
npm install @imatomix/mixer @imatomix/mix-compress
```

## 使い方

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { compress } from '@imatomix/mix-compress'

const app = new Mixer()

app.mix(compress(), () => ({ items: [] }))

await serve(app, { port: 3000 })
```

早めに mix する。それより後ろで mix したものの応答を圧縮する。Brotli か gzip かは、クライアントの `Accept-Encoding` から選ぶ。

## オプション

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `minBytes` | `1024` | 長さが分かっていて、これより短い本文はそのまま送る |
| `allowCredentialed` | `false` | `Cookie` や `Authorization` を持つリクエストへの応答も圧縮する（[既定で切っている理由](#サインイン中のページ)） |
| `filter` | なし | `(ctx, response) => boolean`。`false` を返した応答は圧縮しない |

1 つの応答だけ外したいときは、`Cache-Control: no-transform` を付けてもよい。

## サインイン中のページ

既定では、`Cookie` や `Authorization` を持つリクエストへの応答は圧縮しない。秘密の値（トークン、個人の情報）と、攻撃者が左右できる文字列（検索語、URL から取った名前など）の両方を含む応答を圧縮すると、そのサイズから秘密が推測されることがある（BREACH 攻撃）。この 2 つが一緒に現れやすいのが、サインイン中のページだからである。

サインイン中のページで、秘密の値と第三者が左右できる文字列が並ばないことを確かめてから `allowCredentialed` を有効にする。そうしたページは `filter` で外してもよい。

```ts
app.mix(
  compress({
    allowCredentialed: true,
    filter: (ctx) => !ctx.path.startsWith('/account'),
  }),
)
```

## 圧縮するもの

本文のある、テキスト・JSON・XML・JavaScript・SVG などの応答を圧縮する。次のものはそのまま送る。

- `HEAD` のリクエスト、`204`・`205`・`206`・`304` の応答、`Content-Range` を持つ応答
- すでに `Content-Encoding` を持つ応答。mix-static の[圧縮済みファイル](https://github.com/imatomix/mixer/blob/main/packages/mix-static/README.ja.md#圧縮済みファイル)など
- `text/event-stream`（mixer の [`sse()`](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.ja.md#server-sent-events)）。イベントごとにクライアントへ届く必要がある
- `ETag` を持つ応答。圧縮すると、本文とその ETag が合わなくなる
- 画像・動画・アーカイブなど、圧縮しても縮まない種類
- 長さが分かっていて `minBytes` より短いもの。`Response.json()` のようにアプリが作った `Response` は長さが分からないので、大きさにかかわらず圧縮する

圧縮した応答には `Content-Encoding` を付け、`Content-Length` を外す。圧縮されうる応答には、`Vary: Accept-Encoding` を付ける。`allowCredentialed` が無効のあいだは `Cookie, Authorization` も付ける。圧縮するかどうかを、これらのリクエストヘッダーで決めているためである。手前の共有キャッシュは当たりにくくなる。CDN があるならそちらに圧縮させる理由がもう 1 つ増える。

## ストリーム

ストリームの応答は、作られるそばから圧縮する。ストリームがすでに用意している塊はまとめて圧縮し、ストリームが待ちに入るたびに、そこまでに圧縮したものを送り出す。そのため、HTML を少しずつ送るページも、少しずつ届く。ただし、手前のプロキシがためこむことはある。

クライアントが去ると、ストリームを止める。
