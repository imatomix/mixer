# @imatomix/mix-logger

Request logger for [mixer](../mixer).

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-logger
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { logger } from '@imatomix/mix-logger'

const app = new Mixer()

app.mix(logger(), () => 'Hello Mixer')

await app.listen(3000)
```

```
2026-11-21T00:00:00.000Z GET /hello 200 1.2ms 11B
```

処理時間は logger が実行された時点から計るので、**できるだけ前に** mix する。
記録は応答を送り終えたとき（または接続が切れたとき）に 1 回だけ行う。

## 出力先を変える

`write` には構造化した記録（`LogEntry`）が渡る。JSON で出したり、外部に送ったりできる。

```ts
app.mix(
  logger({
    write: (entry) => {
      process.stdout.write(`${JSON.stringify(entry)}\n`)
    },
  }),
)
```

| プロパティ | 説明 |
| --- | --- |
| `time` | リクエストを受け取った時刻（`Date`） |
| `method` | HTTP メソッド |
| `path` | パス（**クエリは含めない**） |
| `status` | ステータスコード |
| `durationMs` | 処理時間（ミリ秒） |
| `contentLength` | 応答の `Content-Length` ヘッダの値。ストリームなどで未設定なら `undefined` |
| `aborted` | 応答を送り終える前に接続が切れた |

`formatLogEntry(entry)` で、既定の 1 行の形式に変換できる。

## 安全性

- クエリはキーにも値にもトークンやメールアドレスが入りうるので、記録しない
- 既定の形式では改行やエスケープシーケンスなどの制御文字をエスケープし、偽の行や色付けをログに差し込ませない（`write` で独自に出力する場合は各自で扱うこと）
- `write` が例外を投げたり Promise が失敗したりしても、`console.error` に出すだけで応答やサーバには影響しない

## v0.0.x からの移行

| v0.0.x | v0.1 |
| --- | --- |
| `const logger = require('mix-logger')` | `import { logger } from '@imatomix/mix-logger'` |
| `new mixer(logger)` | `app.mix(logger())`（関数を呼ぶ形に変更） |
| 同時のリクエストで処理時間が混ざっていた | リクエストごとに計測する |
| メモリ使用量を出力 | 出力しない |
| URL をクエリごと出力 | パスのみ |
