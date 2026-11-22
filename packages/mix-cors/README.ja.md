# @imatomix/mix-cors

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-cors/README.md) | 日本語

[mixer](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md) の CORS。Origin は完全一致で照合し、preflight はルートに届く前に応答する。

- 動く場所: Node.js・Bun・Cloudflare Workers
- 0.x なので、マイナーバージョンの間で API が変わることがある

## インストール

```sh
npm install @imatomix/mixer @imatomix/mix-cors
```

## 使い方

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { cors } from '@imatomix/mix-cors'

const app = new Mixer()

app.mix(cors({ origin: 'https://example.com' }), () => 'cors is mixed!')

await serve(app, { port: 3000 })
```

ルーターなどより**前に** mix する。`origin` は必須。応答を読んでよいサイトを並べるか、どのサイトからも読める公開 API なら `origin: '*'` を渡す。

## オプション

```ts
cors({
  origin: ['https://example.com', /^https:\/\/[a-z]+\.example\.com$/],
  credentials: true,
  exposeHeaders: ['X-Total-Count'],
})
```

| オプション | 初期値 | 説明 |
| --- | --- | --- |
| `origin` | 必須 | 許可する Origin。どのサイトにも許可するなら `'*'`。文字列・正規表現・それらの配列・関数 `(origin, ctx) => boolean \| Promise<boolean>` |
| `credentials` | `false` | Cookie などの資格情報付きリクエストを許可する |
| `methods` | `['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']` | preflight で許可するメソッド |
| `allowHeaders` | リクエストされたヘッダをそのまま許可 | preflight で許可するリクエストヘッダ |
| `exposeHeaders` | なし | ブラウザの JavaScript から読めるようにするレスポンスヘッダ |
| `maxAge` | `600` | preflight の結果をブラウザがキャッシュする秒数（Chrome は 7200 秒が上限） |

### origin の注意

- 文字列は完全一致で比べる。`'https://example.com'` は `https://example.com.evil` に一致しない
- 正規表現は **Origin 全体と一致したときだけ**許可する（内部で `^(?:…)$` に包む）。`/example\.com/` や `/^a|b$/` と書いても `https://example.com.evil` には一致しない。`g` / `y` フラグは無視する
- `'*'` 以外を指定すると、一致した Origin をそのまま返し、`Vary: Origin` を付ける（キャッシュが別の Origin に使い回さないように）

### `origin: '*'` と `credentials: true` は併用できない

ブラウザはこの組み合わせを拒否する。送られてきた Origin をそのまま返して回避すると、どのサイトからでも資格情報付きでレスポンスを読めてしまう。
そのため `cors()` を呼んだ時点でエラーにしている。資格情報を使うときは許可する Origin を明示する。

## 振る舞い

| リクエスト | 動作 |
| --- | --- |
| `Origin` ヘッダなし（同一オリジンなど） | CORS ヘッダは付けずに次へ進む（`origin` を限定しているときは `Vary: Origin` だけ付ける） |
| preflight（`OPTIONS` + `Origin` + `Access-Control-Request-Method`） | その場で `204` を返して完結する。許可しない Origin には CORS ヘッダを付けない |
| それ以外 | 許可した Origin なら CORS ヘッダを付けて次へ進む |

- preflight は後続のコンポーネントに流れないので、アプリ側で OPTIONS を意識しなくてよい
- preflight ではない `OPTIONS` は横取りしない（mix-router の `options()` などがそのまま動く）
- 付けたヘッダは、後続で `HttpError` になったときのエラー応答にも残り（ブラウザからエラー内容を読める）、後続のコンポーネントが返した `Response` にも付く

