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
```

## 設計原則

ユーザーが「必要なものだけ選べる」「別の実装に差し替えられる」ことを最優先にする。

- mix-* は mixer に `peerDependencies` で依存し、原則 `import type` のみ使う（実行時に mixer のコードを読み込まない）
  - `devDependencies` には `"@imatomix/mixer": "workspace:*"` を入れる
- mix-* 同士は依存しない。他のモジュールの存在を前提にしない
- 各モジュールは「オプションを受け取り `Component` を返す関数」を named export する（例: `cors(options)`）。default export は使わない
- `ctx.req` / `ctx.res` に独自プロパティを足さない。後続に値を渡すときは `ctx.state` を使い、その型を export する
- 応答するなら値を return するか `ctx.send()`、次のコンポーネントに進むなら `undefined` を返す

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

## 周辺モジュールの TypeScript 移行

`packages/mix-*/lib/*.js` は v0.0.x の `(req, res)` 形式のままのものがある。移行するときは `migrate-module` skill の手順に従う。
