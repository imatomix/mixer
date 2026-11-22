# @imatomix/mix-logger

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-logger/README.md) | 日本語

[mixer](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md) のアクセスログ。リクエストごとに 1 行で、クエリは記録せず、偽の行を差し込ませない。

- 動く場所: Node.js・Bun・Cloudflare Workers
- 0.x なので、マイナーバージョンの間で API が変わることがある

## インストール

```sh
npm install @imatomix/mixer @imatomix/mix-logger
```

## 使い方

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { logger } from '@imatomix/mix-logger'

const app = new Mixer()

app.mix(logger(), () => 'Hello Mixer')

await serve(app, { port: 3000 })
```

```
2026-11-21T00:00:00.000Z GET /hello 200 1.2ms 11B
```

処理時間は logger が実行された時点から計るので、**できるだけ前に** mix する。
記録は最終的な `Response` ができたとき（`ctx.onResponse`）に 1 回だけ行う。

## 出力先を変える

`write` には構造化した記録（`LogEntry`）が渡る。JSON で出したり、外部に送ったりできる。

```ts
app.mix(
  logger({
    write: (entry) => {
      console.log(JSON.stringify(entry))
    },
  }),
)
```

| プロパティ | 説明 |
| --- | --- |
| `time` | リクエストを受け取った時刻（`Date`） |
| `method` | HTTP メソッド |
| `path` | `basePath` を含むパス（**クエリは含めない**） |
| `status` | ステータスコード |
| `responseDurationMs` | logger が動いてから `Response` ができるまでのミリ秒。**本文を送る時間は含まない** |
| `contentLength` | 応答の `Content-Length` ヘッダの値。ストリームなどで長さが分からなければ `undefined` |

`formatLogEntry(entry)` で、既定の 1 行の形式に変換できる。既定では `console.log` で出力する。

`write` が Promise を返しても、応答はそれを待たない。`ctx.waitUntil` に渡す。応答のあとで止まりうる環境では、書き込みが打ち切られないよう、その環境の応答後の処理を登録する API を `app.fetch` に渡す（[mixer の `ctx.waitUntil()`](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md#ctxwaituntil) を参照）。

## 安全性

- クエリはキーにも値にもトークンやメールアドレスが入りうるので、記録しない
- 既定の形式では改行やエスケープシーケンスなどの制御文字をエスケープし、偽の行や色付けをログに差し込ませない（`write` で独自に出力する場合は各自で扱うこと）
- `write` が例外を投げたり Promise が失敗したりしても、`console.error` に出すだけで応答やサーバには影響しない

