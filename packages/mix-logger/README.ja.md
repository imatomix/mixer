# @imatomix/mix-logger

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-logger/README.md) | 日本語

Request logger for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer).

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-logger
```

## Usage

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

`write` が Promise を返しても、応答はそれを待たない。`ctx.waitUntil` に渡すので、サーバーレス環境でも応答のあとまで実行される。

## 安全性

- クエリはキーにも値にもトークンやメールアドレスが入りうるので、記録しない
- 既定の形式では改行やエスケープシーケンスなどの制御文字をエスケープし、偽の行や色付けをログに差し込ませない（`write` で独自に出力する場合は各自で扱うこと）
- `write` が例外を投げたり Promise が失敗したりしても、`console.error` に出すだけで応答やサーバには影響しない

## v0.1 からの移行

| v0.1 | v0.2 |
| --- | --- |
| `durationMs`（応答を送り終えるまで） | `responseDurationMs`（`Response` ができるまで。送信の時間は含まない） |
| `aborted` | 削除。Web 標準のハンドラからは、本文を送っている途中でクライアントが切断したかを知る手段がない |
| `process.stdout.write` で出力 | `console.log` で出力（出力される行は同じ） |

## v0.0.x からの移行

| v0.0.x | v0.1 |
| --- | --- |
| `const logger = require('mix-logger')` | `import { logger } from '@imatomix/mix-logger'` |
| `new mixer(logger)` | `app.mix(logger())`（関数を呼ぶ形に変更） |
| 同時のリクエストで処理時間が混ざっていた | リクエストごとに計測する |
| メモリ使用量を出力 | 出力しない |
| URL をクエリごと出力 | パスのみ |
