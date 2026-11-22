# @imatomix/mix-static

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-static/README.md) | 日本語

[mixer](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md) の静的ファイル配信。パストラバーサル、ドットファイル、外を指すシンボリックリンクを防ぐ。

- 動く場所: Node.js・Bun（`node:fs` でファイルを読む。Cloudflare Workers では Workers Static Assets を使う）
- 0.x なので、マイナーバージョンの間で API が変わることがある

## インストール

```sh
npm install @imatomix/mixer @imatomix/mix-static
```

## 使い方

`./public` 以下のファイルを `http://localhost:3000/` から配信する。

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { serveStatic } from '@imatomix/mix-static'

const app = new Mixer()

app.mix(serveStatic('./public'))

await serve(app, { port: 3000 })
```

`./public/images` 以下のファイルを `http://localhost:3000/imgs/` から配信する。

```ts
app.mix(serveStatic('./public/images', { prefix: '/imgs' }))
```

ファイルが見つからなければ何もせず次のコンポーネントへ進む（最終的に mixer の 404 になる）。
ファイルは mixer の `ctx.path` で探すので、`basePath` を使うと公開ディレクトリはその下のパスに対応する。ディレクトリへのリダイレクトでは、`Location` に `basePath` を残す。

## 単体のファイルを配信する（favicon など）

`serveFile(filePath, { maxAge, immutable })` は、常に指定したファイルを返す Component。パスの判定はしないので、[mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router) などと組み合わせる。

```ts
import { get } from '@imatomix/mix-router'
import { serveFile } from '@imatomix/mix-static'

app.mix(
  get('/favicon.ico', serveFile('./assets/favicon.ico', { maxAge: 86400 })),
  get('/robots.txt', serveFile('./assets/robots.txt')),
)
```

- GET と HEAD 以外は次のコンポーネントへ進む
- ファイルは定義時に存在と種類（通常のファイル）を確認する。実行中に消えたら次のコンポーネントへ進む
- レスポンスのヘッダや 304 の扱いは `serveStatic` と同じ

公開ディレクトリに `favicon.ico` を置いているなら、`serveStatic` だけで配信できる（旧 mix-favicon は廃止した）。

## オプション

| オプション | 初期値 | 説明 |
| --- | --- | --- |
| `root`（第1引数） | 必須 | 公開するディレクトリ。存在しないかディレクトリでなければ定義時にエラー |
| `prefix` | `'/'` | このパス以下へのリクエストだけを扱う。セグメント単位で比べる（`/imgs` は `/imgsecret` に一致しない） |
| `index` | `'index.html'` | ディレクトリへのアクセスで返すファイル名。`false` で無効 |
| `maxAge` | `0` | `Cache-Control: public, max-age=N` の秒数 |
| `immutable` | `false` | `Cache-Control` に `immutable` を付ける。同じ名前のまま中身が変わらないファイル（`app.3f9a1c.js` のようにハッシュを含むビルド成果物など）向け。`maxAge` が 1 以上でないと使えない |
| `dotfiles` | `false` | `.env` や `.git/` のようなドットで始まるファイル・ディレクトリを配信する |
| `precompressed` | `false` | クライアントが受け付けるなら、ファイルの隣の `file.br` や `file.gz` を代わりに配信する（[詳細](#圧縮済みファイル)） |

## レスポンス

- `Content-Type`：拡張子から決める（主要な型を内蔵。不明なものは `application/octet-stream`）
- `Content-Length`、`ETag`（弱い ETag）、`Last-Modified`、`Cache-Control`
- `If-None-Match` / `If-Modified-Since` が一致すれば `304`（`If-None-Match` を優先）
- `HEAD` はファイルを読まずにヘッダだけを返す
- Range のリクエスト（動画のシークなど）には、要求された部分だけを `206` で返す。範囲がファイルの末尾より先から始まるときは `416`。1 つのリクエストで扱う範囲は 1 つだけで、複数の範囲や不正な `Range` にはファイル全体を返す。`If-Range` が付いていれば、`ETag` が弱い ETag なのでファイル全体を返す
- 本文はストリームで送り、応答が終わるかクライアントが切断するとファイルを閉じる
- `X-Content-Type-Options: nosniff` は mixer がすべての応答に付ける
- ディレクトリに末尾の `/` がなければ、`/` 付きへ `301` でリダイレクトする（HTML 内の相対リンクを正しく解決させるため）

## 圧縮済みファイル

`precompressed: true` にすると、ビルドで `app.js` の隣に `app.js.br` と `app.js.gz` を書き出しておけば、リクエストのたびに圧縮しなくて済む。

- 形式は `Accept-Encoding` で選ぶ（q 値に従う。`identity` や `*` で圧縮しない方が優先されていれば元のファイルを返し、同じなら Brotli を優先）。受け付けられる形式がなければ元のファイルを返す
- 応答は元のファイルの `Content-Type` を保ち、`Content-Encoding` を付け、`ETag` は圧縮ファイルごとに別になる。`precompressed` を有効にした配信では、どの応答にも `Vary: Accept-Encoding` を付ける
- 元のファイルより古い圧縮ファイルは使わないので、ビルドが古いままでも古い内容を配らない
- 圧縮ファイルは、下の安全確認をすべて通った元のファイルの実際のパスの隣から開き、シンボリックリンクはたどらない
- Range と `304` は、実際に送るファイルに対して判定する

## 安全性

次のリクエストは配信しない（次のコンポーネントへ進む）。

- `..` や `.` のセグメント、デコードすると `/`・`\`・NUL になるセグメント（`/..%2F..%2Fetc/passwd` など）
- 途中に空のセグメントを含むパス（`//admin/x`）。生のパスの前方一致で認可する別の層と解釈が食い違わないようにするため
- ドットファイル・ドットディレクトリ（`dotfiles: false` のとき）
- シンボリックリンクの実体が公開ディレクトリの外にあるもの、または実体がドットファイルのもの

不正な URL エンコーディングは `400 Bad Request` になる。

**公開ディレクトリは、信頼できない利用者が書き換えられない場所にすること。** 検証してからファイルを開くまでの間にシンボリックリンクを差し替えられる攻撃は、最後の要素については `O_NOFOLLOW` で防いでいるが、途中のディレクトリの差し替えまでは防げない。

