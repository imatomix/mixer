# @imatomix/mix-static

Serve static files for [mixer](../mixer).

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-static
```

## Usage

`./public` 以下のファイルを `http://localhost:3000/` から配信する。

```ts
import { Mixer } from '@imatomix/mixer'
import { serveStatic } from '@imatomix/mix-static'

const app = new Mixer()

app.mix(serveStatic('./public'))

await app.listen(3000)
```

`./public/images` 以下のファイルを `http://localhost:3000/imgs/` から配信する。

```ts
app.mix(serveStatic('./public/images', { prefix: '/imgs' }))
```

ファイルが見つからなければ何もせず次のコンポーネントへ進む（最終的に mixer の 404 になる）。

## Options

| オプション | 初期値 | 説明 |
| --- | --- | --- |
| `root`（第1引数） | 必須 | 公開するディレクトリ。存在しないかディレクトリでなければ定義時にエラー |
| `prefix` | `'/'` | このパス以下へのリクエストだけを扱う。セグメント単位で比べる（`/imgs` は `/imgsecret` に一致しない） |
| `index` | `'index.html'` | ディレクトリへのアクセスで返すファイル名。`false` で無効 |
| `maxAge` | `0` | `Cache-Control: public, max-age=N` の秒数 |
| `dotfiles` | `false` | `.env` や `.git/` のようなドットで始まるファイル・ディレクトリを配信する |

## レスポンス

- `Content-Type`：拡張子から決める（主要な型を内蔵。不明なものは `application/octet-stream`）
- `X-Content-Type-Options: nosniff`、`Content-Length`、`ETag`（弱い ETag）、`Last-Modified`、`Cache-Control`
- `If-None-Match` / `If-Modified-Since` が一致すれば `304`（`If-None-Match` を優先）
- `HEAD` はファイルを読まずにヘッダだけを返す
- ディレクトリに末尾の `/` がなければ、`/` 付きへ `301` でリダイレクトする（HTML 内の相対リンクを正しく解決させるため）
- Range リクエスト（動画のシークなど）には未対応

## 安全性

次のリクエストは配信しない（次のコンポーネントへ進む）。

- `..` や `.` のセグメント、デコードすると `/`・`\`・NUL になるセグメント（`/..%2F..%2Fetc/passwd` など）
- 途中に空のセグメントを含むパス（`//admin/x`）。生のパスの前方一致で認可する別の層と解釈が食い違わないようにするため
- ドットファイル・ドットディレクトリ（`dotfiles: false` のとき）
- シンボリックリンクの実体が公開ディレクトリの外にあるもの、または実体がドットファイルのもの

不正な URL エンコーディングは `400 Bad Request` になる。

**公開ディレクトリは、信頼できない利用者が書き換えられない場所にすること。** 検証してからファイルを開くまでの間にシンボリックリンクを差し替えられる攻撃は、最後の要素については `O_NOFOLLOW` で防いでいるが、途中のディレクトリの差し替えまでは防げない。

## v0.0.x からの移行

| v0.0.x | v0.1 |
| --- | --- |
| `const static = require('mix-static')` | `import { serveStatic } from '@imatomix/mix-static'` |
| `static({ public: './public' })` | `serveStatic('./public')` |
| `public` の初期値 `'./'` | 必須（カレントディレクトリ全体を誤って公開しないように） |
| `route` | `prefix`（セグメント単位で比べる） |
| ドットファイルも配信 | 既定では配信しない |
| `Content-Type` なし | 拡張子から設定 |
