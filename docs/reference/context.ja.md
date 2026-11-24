# ctx

[English](context.md) | 日本語

コンポーネントが 1 つ目の引数として受け取るもの。

## ctx

| プロパティ | 説明 |
| --- | --- |
| `ctx.request` | Web 標準の `Request` |
| `ctx.url` | リクエストの URL（`URL`。クエリは `ctx.url.searchParams`） |
| `ctx.path` | `basePath` を除いたパス。ルーティングにはこれを使う |
| `ctx.method` | HTTP メソッド |
| `ctx.status` / `ctx.headers` | 組み立て中の応答のステータス（既定 `200`）とヘッダ |
| `ctx.state` | 後のコンポーネントに渡す値 |
| `ctx.env` | `app.fetch` の第 2 引数で渡すバインディングや設定 |
| `ctx.ip` / `ctx.remoteAddress` | クライアントの IP アドレスと、直接の接続元の IP アドレス（[詳細](mixer.ja.md#クライアントの-ip-アドレス)） |
| `await ctx.json()` / `await ctx.form()` | JSON として、またはフォームやファイルのアップロードの `FormData` として読んだリクエストボディ（[詳細](../../packages/mixer/README.ja.md#リクエストボディ)） |
| `await ctx.text()` / `await ctx.bytes()` | 文字列またはバイト列として読んだリクエストボディ |
| `ctx.cookies` | Cookie を読み、応答に付ける（[詳細](responses.ja.md#cookie)） |
| `ctx.error` | `await next()` のあと、後ろのコンポーネントが投げたエラー（なければ `undefined`）（[詳細](../../packages/mixer/README.ja.md#next-で包む)） |
| `ctx.onErrorReport(fn)` | このリクエストの想定外のエラーを受け取る（[詳細](responses.ja.md#エラーの報告)） |
| `ctx.waitUntil(promise)` | 応答を待たせずに、応答のあとで処理する（[詳細](../../packages/mixer/README.ja.md#ctxwaituntil)） |
