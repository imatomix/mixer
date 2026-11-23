# mixer todo の例

[English](README.md) | 日本語

mixer とそのモジュールで作った、サーバーで HTML を返す小さな Todo アプリ。ログインして Todo を追加・完了・削除できる。ブラウザにページを返すアプリのおすすめの組み合わせを示し、テストでモジュールを組み合わせて確かめる。

**このままでは本番に使えない。** ユーザー・Todo・セッションはメモリにあり再起動で消える。デモ用のアカウントはパスワードを平文で持っている。自分の手元以外で使う前に、`src/data.ts` を置き換え、共有できる `sessionStore` を渡す。

```sh
pnpm --filter @imatomix/example-todo start      # Node.js。http://localhost:3000 で demo / demo でログイン
pnpm --filter @imatomix/example-todo start:bun  # Bun
pnpm --filter @imatomix/example-todo test       # app.fetch を通したテスト
pnpm --filter @imatomix/example-todo check:bun      # Bun.serve でブラウザの流れを確かめる
pnpm --filter @imatomix/example-todo check:workers  # Node.js 互換なしの workerd でブラウザの流れを確かめる
```

## 示していること

- コンポーネントの順番: `logger()`、CSP 付きの `secureHeaders()`、静的ファイル、`csrf()`、ページを保存させない指定、`session()`、ルート
- `session.regenerate()` でのログイン、`session.destroy()` を呼ぶ POST でのログアウト、すべての POST のあとの `303` リダイレクト
- 別のユーザーの Todo には決して届かない。検索にユーザーの ID を使い、存在しない Todo と他人の Todo は同じ `404` にする
- すべての値をエスケープする小さな `html` タグ（`src/html.ts`）で組み立てる HTML
- `onError` のエラーページにリクエスト ID を表示する。同じ ID がログと `X-Request-Id` にも出る
- Node.js（`src/node.ts`）・Bun（`src/bun.ts`）・Cloudflare Workers（`src/worker.ts`）の入口。Workers では `public/` を Static Assets で配信し、mix-session の Redis ストアなどの外部セッションストアを使う
