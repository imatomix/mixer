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
pnpm --filter @imatomix/example-todo dev:web    # React のフロントを http://localhost:5173 で。API は start で起動したアプリ
pnpm --filter @imatomix/example-todo build:web  # フロントを web/dist にビルドする
```

## 示していること

- 役割ごとに 1 ファイル: `src/app.ts` は部品を組み立てるだけ。ルートはリソースごとに `src/routes/` に置く（サインインと Todo。Todo は `GET /todos` の一覧とその操作で、`group('/todos', ...)` で載せる。`/` は一覧へリダイレクトする）。アプリの State の型とルートの関数は `src/router.ts`、サインインの確認は `src/auth.ts`、画面は `src/pages.ts`
- 同じオリジンのフロントのための、`/api` 以下の JSON の API: サインインとサインアウトの `POST /api/session` と `DELETE /api/session`、`GET /api/me`、`GET`・`POST /api/todos` と `PATCH`・`DELETE /api/todos/:id`。入力は `validateInput()` と Zod で確かめ、知らない API のパスは JSON の `404`、エラーはリクエスト ID 付きの JSON で答える
- JSON の API を使う、`web/` の React のフロント（Vite。ルーターや状態管理のライブラリは使わない）。`web/src/api.ts` は相対 URL の `/api` を呼ぶので、セッションの Cookie が毎回付く。失敗はプロキシが返したページも含めてすべて 1 つの `ApiError` にし、サーバー側の失敗はリクエスト ID 付きで表示する。`web/src/hooks/` のフックがデータの読み込みと API 経由の更新を担当する。読み込みに失敗したときは再試行できるようにし、古くなった応答は無視する。コンポーネントは画面を描画し、追加フォームの送信や、Todo の追加に成功したあとのフォームのリセットなど、画面上の操作を扱う。開発中は Vite が `/api` を `start` で起動したアプリへ渡す。ビルドしたフロントはまだアプリから配信しておらず、`start` で見えるのはサーバーで返す画面のまま
- コンポーネントの順番: `logger()`、CSP 付きの `secureHeaders()`、静的ファイル（キャッシュさせるため `session()` より前）、`csrf()`、`session()`（ログイン中のページをキャッシュに残さない）、ログインのルート、1 か所のログイン確認、それが必要なルート
- `session.regenerate()` でのログイン、`session.destroy()` を呼ぶ POST でのログアウト、すべての POST のあとの `303` リダイレクト
- コンポーネントは順に動くので、1 か所のログイン確認がそのあとのすべてのルートに効く。ログインしていない人が存在しないパスを開いたときもログインページに送る
- フォームは `ctx.form()` で読む。フォーム以外には `415` を返す
- 別のユーザーの Todo には決して届かない。検索にユーザーの ID を使い、存在しない Todo と他人の Todo は同じ `404` にする
- すべての値をエスケープする小さな `html` タグ（`src/html.ts`）で組み立てる HTML
- `onError` のエラーページにリクエスト ID を表示する。同じ ID がログと `X-Request-Id` にも出る
- mixer の安全な既定付きの `serve()` を使う Node.js（`src/node.ts`）と Bun（`src/bun.ts`）、Cloudflare Workers（`src/worker.ts`）の入口。Workers では `public/` を Static Assets で配信し、mix-session の Redis ストアなどの外部セッションストアを使う
