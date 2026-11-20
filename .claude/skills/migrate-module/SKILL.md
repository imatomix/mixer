---
name: migrate-module
description: packages/mix-* の古い JS モジュール（(req, res) 形式の lib/*.js）を、mixer v0.1 の ctx 形式の TypeScript に移行する。「mix-router を移行して」「mix-* を TypeScript にして」と頼まれたときに使う。
---

# mix-* モジュールの移行手順

対象: `packages/<name>/lib/*.js` が残っているパッケージ。ルートの CLAUDE.md の設計原則を前提とする。
手本は `packages/mixer`（構成・テストの書き方）。移行済みの mix-* があればそれも参照する。

## 1. 現状を読んで報告する（コードを書く前に）

- `lib/*.js` と `README.md` を全部読み、機能を箇条書きにする
- 既存のバグ・非推奨 API・セキュリティ上の問題を洗い出す
- `req` / `res` に書き込んでいるプロパティ（`req.params` など）を列挙し、`ctx.state` か mixer 側の変更か、どこに置くかを決める
- **mixer の API 変更が必要そうなら、ここで止めてユーザーに相談する**
- 旧 API に縛られず、拡張性・保守性・セキュリティの観点でより良い設計を考え、改善点として提示する
- 公開 API（関数名・オプション）の案を示し、ユーザーの確認を取ってから実装に進む

## 2. パッケージ構成を作る

`packages/mixer` に合わせる:

- `package.json`
  - `"type": "module"`, `exports`（`types` + `import`）, `files: ["dist"]`, `engines.node: ">=20"`
  - scripts: `build`（`tsup && tsc -p tsconfig.build.json`）, `typecheck`, `test`, `test:watch`, `prepublishOnly`
  - `peerDependencies: { "@imatomix/mixer": "^0.1.0" }`
  - `devDependencies`: `"@imatomix/mixer": "workspace:*"` と、`catalog:` 指定の `@types/node` / `tsup` / `typescript` / `vitest`
  - version は `0.1.0`
- `tsconfig.json`（`../../tsconfig.base.json` を extends）、`tsconfig.build.json`、`tsup.config.ts`、`vitest.config.ts` を mixer からコピーする
  - `vitest.config.ts` は monorepo 内で mixer を `src` から解決するために必要（`@imatomix/source` condition）
- `pnpm install` を実行する

## 3. テストを書いてから実装する

- `test/*.test.ts` に、移行前の機能と 1. で決めた修正点のテストを先に書き、失敗することを確認する
- `src/index.ts` に実装し、`lib/` を削除する

## 4. ドキュメント

- パッケージの `README.md` を新しい API で書き直す。末尾に v0.0.x からの移行表を付ける
- ルートの `README.md` のパッケージ表に追加する
- `biome.json` の `!packages/*/lib` は、すべての移行が終わったら削除する

## 5. 確認とコミット

- `pnpm format` と `pnpm check`、`pnpm --filter @imatomix/<name> build` を通す
- `dist/index.js` が mixer の公開 API 以外を import していないことを確認する
- `pnpm verify:pack` を通す（移行したパッケージは自動で検証対象になる。mix-router のような組み合わせの動作確認が必要なら `scripts/verify-pack.mjs` に足す）
- 削除済みの `lib/` を含めてステージするときは `git add -A <dir>` を使う（`git add <削除済みのパス>` は pathspec エラーになり、後続のコミットに削除が紛れ込む）。コミット後は `git show --stat` で中身を確かめる
- コミットを分ける（例）:
  1. `build(<name>): TypeScript の開発環境を追加`
  2. `feat(<name>)!: ctx 形式の TypeScript に移行する`（直したバグを本文に列挙する）
  3. `docs(<name>): README を新しい API に合わせて書き直す`
- 移行中に気づいた、CLAUDE.md や本 skill に足すべきことがあればユーザーに提案する
