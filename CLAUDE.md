# mixer monorepo

Minimal & asynchronous web module `@imatomix/mixer` と、その周辺モジュール（mix-*）の pnpm workspaces monorepo。

## 構成

- `packages/mixer` … 本体。`Mixer` / `Context` / `Component` / `HttpError` を提供する
- `packages/mix-*` … 周辺モジュール。npm に個別公開し、ユーザーが必要なものだけ選んで導入する
- 共通設定はルートにある: `tsconfig.base.json`, `biome.json`, `pnpm-workspace.yaml`（`catalog:` で依存バージョンを一元管理）

## コマンド

```sh
pnpm check                           # lint + typecheck + test（全パッケージ）。完了報告の前に必ず通す
pnpm build
pnpm --filter @imatomix/<name> test  # 特定パッケージのみ
pnpm format                          # biome で自動整形
pnpm verify:pack                     # npm pack した公開物を利用側としてインストールし、型と import を検証
```

コミットの前に `pnpm format` と `pnpm check` を必ず通す。package.json の `exports` / `files` / 依存を変えたときは `pnpm verify:pack` も通す（monorepo 内のテストは src を参照するので、dist の不備に気づけない）。

## 設計原則

既存の `lib/*.js` は作者が昔、学習目的で書いたもので、設計の誤りも含みうる。**旧 API の再現を目標にしない**。拡張性・保守性・セキュリティの観点から、より良い設計があれば積極的に提案する。選択肢を挙げるときは、理由付きで推奨を 1 つ示す。

ユーザーが「必要なものだけ選べる」「別の実装に差し替えられる」ことを最優先にする。

- mix-* は mixer に `peerDependencies` で依存する（アプリ内の mixer の実体を 1 つに保ち、`instanceof HttpError` などが正しく働くようにする）
  - `devDependencies` には `"@imatomix/mixer": "workspace:*"` を入れる
  - peer の版範囲は、実際に使っている mixer の API が入った版以上にする（例: `onBeforeSend` を使うならそれが入った版）
  - mixer の公開 API を変えたら、それを使う mix-* の peer の下限と `scripts/verify-pack.mjs` の組み合わせ確認を更新し、必要なら同時に公開する
- パッケージは個別に公開する（`@imatomix/mixer` と `@imatomix/mix-*`）。ユーザーがモジュールごとに選び、版を管理できるようにするため
- mixer の**公開 API**（`src/index.ts` から export されているもの）は実行時にも使ってよい（`HttpError` など）。内部実装には依存しない
- エラーで応答するときは `ctx.send()` で直接返さず `HttpError` を投げる。ユーザーが `onError` でまとめて差し替えられるようにするため
- mix-* 同士は依存しない。他のモジュールの存在を前提にしない
- 各モジュールは「オプションを受け取り `Component` を返す関数」を named export する（例: `cors(options)`）。default export は使わない
- `ctx.req` / `ctx.res` に独自プロパティを足さない。後続に値を渡すときは `ctx.state` を使い、その型を export する
- 応答するなら値を return するか `ctx.send()`、次のコンポーネントに進むなら `undefined` を返す
- 応答直前に処理が必要なら `ctx.onBeforeSend()`、応答後の観測（ログなど）は `ctx.res` の `finish` / `close` イベントを使う

## mixer の API を変えたくなったら

mix-* の移行中に mixer 側の変更（新しいプロパティ、型の追加、挙動の変更）が欲しくなったら、**実装を始める前に手を止めてユーザーに相談する**。mix-* 側で無理に回避しない。
合意したら mixer の変更を先に別コミットで入れ、テストを追加する。

## コーディング規約

- TypeScript strict（`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` を含む）、ESM のみ、Node.js 20 以上
- import には `.js` 拡張子を付ける（NodeNext）。`node:` プレフィックスを使う
- スタイルは biome に従う（2 スペース、シングルクォート、セミコロンなし）
- 実行時の依存（dependencies）は増やさない。必要なら事前に確認を取る

## テスト

- vitest を使い、`packages/<name>/test/*.test.ts` に置く
- `new Mixer().mix(...)` を `listen(0, '127.0.0.1')` で実際に起動し、`fetch` で叩いて確かめる（モックの req/res は使わない）
- `afterEach` で `app.close()` してポートを残さない
- テスト名は日本語で、振る舞いを書く（例: 「preflight には 204 を返す」）

## Git

- コミットメッセージは日本語。Conventional Commits にパッケージ名のスコープを付ける（例: `feat(mix-router): ...`, `fix(mixer): ...`）
- パッケージをまたぐ変更は、パッケージごと・論理単位ごとにコミットを分ける
- 破壊的変更は `!` と `BREAKING CHANGE:` を付ける

## 新しいモジュールを追加するとき

v0.0.x からの移行はすべて完了した（mix-favicon は廃止し、mix-static の `serveFile` に統合）。
新しい mix-* を作るときも `migrate-module` skill の手順 2〜5（パッケージ構成・テスト先行・ドキュメント・確認とコミット）に従う。
追加する前に、既存のモジュールの拡張で足りないか、mixer 本体に置くべき基本機能ではないかを検討する（例: favicon は mix-static に統合、Cookie は mixer 本体に置いた）。
