# @imatomix/mix-cors

CORS for [mixer](../mixer).

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-cors
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { cors } from '@imatomix/mix-cors'

const app = new Mixer()

app.mix(cors(), () => 'cors is mixed!')

await app.listen(3000)
```

ルーターなどより**前に** mix する。

## Options

```ts
cors({
  origin: ['https://example.com', /^https:\/\/[a-z]+\.example\.com$/],
  credentials: true,
  exposeHeaders: ['X-Total-Count'],
})
```

| オプション | 初期値 | 説明 |
| --- | --- | --- |
| `origin` | `'*'` | 許可する Origin。文字列・正規表現・それらの配列・関数 `(origin, ctx) => boolean \| Promise<boolean>` |
| `credentials` | `false` | Cookie などの資格情報付きリクエストを許可する |
| `methods` | `['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']` | preflight で許可するメソッド |
| `allowHeaders` | リクエストされたヘッダをそのまま許可 | preflight で許可するリクエストヘッダ |
| `exposeHeaders` | なし | ブラウザの JavaScript から読めるようにするレスポンスヘッダ |
| `maxAge` | `600` | preflight の結果をブラウザがキャッシュする秒数（Chrome は 7200 秒が上限） |

### origin の注意

- 文字列は完全一致で比べる。`'https://example.com'` は `https://example.com.evil` に一致しない
- 正規表現は `^` と `$` で両端を固定すること。`/example\.com/` は `https://example.com.evil` にも一致してしまう
- `'*'` 以外を指定すると、一致した Origin をそのまま返し、`Vary: Origin` を付ける（キャッシュが別の Origin に使い回さないように）

### `origin: '*'` と `credentials: true` は併用できない

ブラウザはこの組み合わせを拒否する。送られてきた Origin をそのまま返して回避すると、どのサイトからでも資格情報付きでレスポンスを読めてしまう。
そのため `cors()` を呼んだ時点でエラーにしている。資格情報を使うときは許可する Origin を明示する。

## 振る舞い

| リクエスト | 動作 |
| --- | --- |
| `Origin` ヘッダなし（同一オリジンなど） | 何もせず次へ進む |
| preflight（`OPTIONS` + `Origin` + `Access-Control-Request-Method`） | その場で `204` を返して完結する。許可しない Origin には CORS ヘッダを付けない |
| それ以外 | 許可した Origin なら CORS ヘッダを付けて次へ進む |

- preflight は後続のコンポーネントに流れないので、アプリ側で OPTIONS を意識しなくてよい
- preflight ではない `OPTIONS` は横取りしない（mix-router の `options()` などがそのまま動く）
- 付けたヘッダは、後続で `HttpError` になったときのエラー応答にも残る（ブラウザからエラー内容を読める）

## v0.0.x からの移行

| v0.0.x | v0.1 |
| --- | --- |
| `const cors = require('mix-cors')` | `import { cors } from '@imatomix/mix-cors'` |
| `allowCredentials`（初期値 `true`） | `credentials`（初期値 `false`） |
| `allowMethods` | `methods`（`OPTIONS` は不要になったので初期値から外した） |
| `allowHeaders`（初期値 `['Accept', 'Content-Type']`） | 初期値はリクエストされたヘッダをそのまま許可 |
| `maxAge`（初期値 86400） | 初期値 600 |
| `origin` は文字列のみ | 文字列・正規表現・配列・関数 |
| すべての OPTIONS を preflight 扱い（応答はしない） | 本物の preflight だけを 204 で完結させる |
