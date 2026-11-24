# @imatomix/mix-logger

[English](https://github.com/imatomix/mixer/blob/main/packages/mix-logger/README.md) | 日本語

[mixer](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md) のリクエスト単位のログ。リクエストごとに ID を振り、その処理の中で記録されるものすべてに同じ ID を付ける。アクセスの行、ハンドラーが書いたログ、想定外のエラーとそのスタック。

- 動く場所: Node.js・Bun・Cloudflare Workers
- 0.x なので、マイナーバージョンの間で API が変わることがある

## インストール

```sh
npm install @imatomix/mixer @imatomix/mix-logger @imatomix/mix-router
```

## 使い方

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { type LoggerState, logger } from '@imatomix/mix-logger'
import { createRouter } from '@imatomix/mix-router'

const { post } = createRouter<LoggerState>()
const app = new Mixer<LoggerState>()

app.mix(
  logger(),
  post('/todos', async (ctx) => {
    const todo = await saveTodo(await ctx.json())
    ctx.state.log.info('created', { todoId: todo.id })
    return todo
  }),
)

await serve(app, { port: 3000 })
```

1 つのイベントが 1 行の JSON になる。

```
{"todoId":7,"level":"info","kind":"app","requestId":"6f1c…","method":"POST","path":"/todos","message":"created","time":"2026-11-23T00:00:00.000Z"}
{"level":"info","kind":"access","requestId":"6f1c…","method":"POST","path":"/todos","status":200,"durationMs":3.1,"contentLength":42,"time":"2026-11-23T00:00:00.000Z"}
```

ハンドラーが例外を投げると、エラーのイベントにも同じ `requestId` が付く。アクセスの行や、利用者から伝えられた ID から、何が起きたかをたどれる。

```
{"level":"error","kind":"error","requestId":"9a2e…","method":"POST","path":"/todos","phase":"handling","error":{"name":"TypeError","message":"…","stack":"…"},"time":"…"}
```

**最初に** mix する。所要時間はこれが動いた時点から測り、後ろのコンポーネントのエラーもここに届く。`onError` が応答に変えたエラー、フックの失敗、`ctx.waitUntil()` に渡した処理の失敗も記録する（mixer の [`ctx.onErrorReport`](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.ja.md#エラーの報告) を使う）。`500` 未満の `HttpError` はエラーのイベントにならず、アクセスのイベントのステータスに出る。

## ハンドラーの中で

`ctx.state.log` には `debug`・`info`・`warn`・`error` があり、どれもメッセージと任意のフィールドを受け取る。利用者に見せたり他のサービスに渡したりするための `requestId` もある。使うにはアプリとルートに `LoggerState` の型を付ける。`new Mixer<LoggerState>()` と、mix-router なら `createRouter<LoggerState>()`（ルートはアプリから型を受け継げない）。ほかの状態と合わせるなら `LoggerState & SessionState` のようにする。

## オプション

```ts
logger({
  write: 'text',
  requestId: (ctx) => ctx.request.headers.get('cf-ray') ?? undefined,
  header: 'X-Correlation-Id',
})
```

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `write` | `'json'` | `'json'` は 1 行に 1 つの JSON、`'text'` は読みやすい 1 行を `console.log`（`ctx.state.log.error` を含め、レベルが `error` のイベントは `console.error`）に書く。関数を渡すと、代わりに各 `LogEvent` を受け取る |
| `requestId` | 新しいランダムな UUID | ID をリクエストから取る `(ctx) => string \| undefined`。Cloudflare の `CF-Ray` など。実行環境やプロキシが付け、クライアントが付けられないヘッダーだけを使う。Cloudflare を前に置かない Node.js や Bun では、`CF-Ray` は誰でも送れる。無いか形が不正（`A-Z a-z 0-9 . _ : -` の 1〜128 文字以外）なら新しく作る |
| `header` | `'X-Request-Id'` | ID を載せる応答ヘッダー。`false` なら付けない。応答の組み立てが失敗したときの `500` を含め、実際に送るすべての応答に付け、ほかの値（ハンドラーが設定した値や、別のサービスの応答をそのまま返した `Response` の値）は置き換える。利用者が目にする ID は必ずログにある。上流の ID をそのまま返したいときは、`requestId` でその ID を選ぶか、ヘッダーを付けない |

開発中は `'text'` のほうが読みやすい。

```
2026-11-23T00:00:00.000Z INFO POST /todos created {"todoId":7} 6f1c…
2026-11-23T00:00:00.000Z INFO POST /todos 200 3.1ms 42B 6f1c…
```

### 別の場所に送る

`write` に渡す関数は `LogEvent` のオブジェクトを受け取るので、mix-logger を pino や OpenTelemetry、ログのサービスに依存させずにつなげる。Promise を返しても応答はそれを待たず、`ctx.waitUntil` に渡す。応答のあとで止まりうる環境では、書き込みが途中で切れないよう、その環境の応答後の処理を登録する API を `app.fetch` に渡す（[mixer の `ctx.waitUntil()`](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.ja.md#ctxwaituntil) を参照）。

| プロパティ | イベント | 説明 |
| --- | --- | --- |
| `time` | すべて | `Date` |
| `level` | すべて | `'debug'`・`'info'`・`'warn'`・`'error'` |
| `kind` | すべて | `'access'`・`'app'`・`'error'` |
| `requestId`・`method`・`path` | すべて | リクエスト。`path` は `basePath` を含み、**クエリは含まない** |
| `message`・`fields` | `app` | ハンドラーが渡したもの |
| `status`・`durationMs`・`contentLength` | `access` | `durationMs` は `Response` ができるまで（**本文の送信は含まない**）。`contentLength` はストリームなど長さが分からないときは無い |
| `phase`・`error` | `error` | 起きた場所と `{ name, message, stack }` |

`formatLogEvent(event)` は `'text'` の 1 行を返す。

## 安全のために

- クエリは記録しない。キーにも値にもトークンやメールアドレスが入りうるため
- `requestId` で選ばない限り、届いた `X-Request-Id` は使わない。クライアントは好きな値を送れて、どのログが同じリクエストのものかを混乱させられるため
- JSON の出力は改行や制御文字をエスケープし、テキストの出力もエスケープするので、リクエストからログの行や色を偽造できない。`'text'` で改行を残すのはエラーのスタックフレームだけで、これはリクエストではなく自分のコードから来る
- JSON の出力で、ハンドラーのフィールドが `requestId`・`level` などの決まったプロパティを置き換えることはできない。循環したオブジェクトなど JSON にできないフィールドは、失敗せずに外す。BigInt は文字列に、Error は名前・メッセージ・スタックにする
- `write` が例外を投げたり Promise が reject されたりしても、`console.error` に出すだけで、応答やサーバーには影響しない

## 限界

- ID が付くのは `ctx.state.log` と mixer のエラー報告を通したものだけ。ハンドラーの中の `console.log` には付かない
- 応答のストリームを送り始めたあとに中で起きたエラーは、mixer からは見えない
- `basePath` の外のパスへの `404` は、どのコンポーネントも動く前に応答するので記録されない
