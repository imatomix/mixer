# mixer todo の例

[English](README.md) | 日本語

mixer とそのモジュールで作った、サーバーで HTML を返す小さな Todo アプリ。ログインして Todo を追加・完了・削除できる。ブラウザにページを返すアプリのおすすめの組み合わせを示し、テストでモジュールを組み合わせて確かめる。

**このままでは本番に使えない。** ユーザー・Todo・セッションはメモリにあり再起動で消える。デモ用のアカウントはパスワードを平文で持っている。自分の手元以外で使う前に、`src/data.ts` を置き換え、共有できる `sessionStore` を渡す。

```sh
pnpm --filter @imatomix/example-todo start      # Node.js。http://localhost:3000 で demo / demo でログイン
pnpm --filter @imatomix/example-todo start:bun  # Bun
pnpm --filter @imatomix/example-todo test       # app.fetch を通したテスト
pnpm --filter @imatomix/example-todo check:bun      # @imatomix/mixer/bun を通して、Bun でブラウザの流れを確かめる
pnpm --filter @imatomix/example-todo check:workers  # Node.js 互換なしの workerd でブラウザの流れを確かめる
```

## 示していること

- 役割ごとに 1 ファイル: `src/app.ts` は部品を組み立てるだけ。ルートはリソースごとに `src/routes/` に置く（サインインと Todo。Todo は `GET /todos` の一覧とその操作で、`group('/todos', ...)` で載せる。`/` は一覧へリダイレクトする）。アプリの State の型とルートの関数は `src/router.ts`、サインインの確認は `src/auth.ts`、画面は `src/pages.ts`
- コンポーネントの順番: `logger()`、CSP 付きの `secureHeaders()`、静的ファイル（キャッシュさせるため `session()` より前）、`csrf()`、`session()`（ログイン中のページをキャッシュに残さない）、ログインのルート、1 か所のログイン確認、それが必要なルート
- `session.regenerate()` でのログイン、`session.destroy()` を呼ぶ POST でのログアウト、すべての POST のあとの `303` リダイレクト
- コンポーネントは順に動くので、1 か所のログイン確認がそのあとのすべてのルートに効く。ログインしていない人が存在しないパスを開いたときもログインページに送る
- フォームは `ctx.form()` で読む。フォーム以外には `415` を返す
- 別のユーザーの Todo には決して届かない。検索にユーザーの ID を使い、存在しない Todo と他人の Todo は同じ `404` にする
- すべての値をエスケープする小さな `html` タグ（`src/html.ts`）で組み立てる HTML
- `onError` のエラーページにリクエスト ID を表示する。同じ ID がログと `X-Request-Id` にも出る
- mixer の安全な既定付きの `serve()` を使う Node.js（`src/node.ts`）と Bun（`src/bun.ts`）、Cloudflare Workers（`src/worker.ts`）の入口。Workers では `public/` を Static Assets で配信し、mix-session の Redis ストアなどの外部セッションストアを使う
