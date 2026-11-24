# mixer のドキュメント

[English](README.md) | 日本語

やりたいことから、どこに何があるかを探すための地図。各ページは mixer の README から分けている途中で、まだページのない項目は README の中を指す。

## 始める

- [すぐ始める](../packages/mixer/README.ja.md#すぐ始める): mixer を入れて、最初のリクエストに答える
- [おすすめの組み合わせ](../README.ja.md#おすすめの組み合わせ): ブラウザ向けのアプリと JSON API で組み合わせるモジュール
- [例のアプリ](../examples/todo): サインイン・セッション・CSRF 対策・セキュリティヘッダーを使った ToDo アプリ。Node.js・Bun・Cloudflare Workers で動く

## アプリを動かす

- [Node.js](how-to/runtimes.ja.md#nodejs)・[Bun](how-to/runtimes.ja.md#bun)・[Cloudflare Workers](how-to/runtimes.ja.md#cloudflare-workers)
- Next.js・Nuxt・SvelteKit・React Router などの[フレームワークの中で使う](how-to/runtimes.ja.md#フレームワークの中で使う)
- [プロキシの後ろで使う](../packages/mixer/README.ja.md#クライアントの-ip-アドレス): クライアントの IP アドレスと `trustedProxies`

## よくある作業

- ルート、ルートのまとまり、`405`: [mix-router](../packages/mix-router/README.ja.md)
- サーバーなしでアプリをテストする: [アプリをテストする](how-to/testing.ja.md)
- アプリを丸ごと載せる（mixer でもほかのフレームワークでも）: [mount](../packages/mix-router/README.ja.md#mount)
- ユーザーのサインインと、ルートの前での確認: [ルートの前で確認する](how-to/auth-and-guards.ja.md)
- リクエストの本文を読んで検証する: [リクエストボディ](how-to/request-body.ja.md)
- Server-Sent Events を送る: [Server-Sent Events](how-to/streaming-and-background-work.ja.md#server-sent-events)
- 時間のかかる処理と、応答のあとの処理: [時間のかかる処理](how-to/streaming-and-background-work.ja.md#時間のかかる処理)・[ctx.waitUntil()](how-to/streaming-and-background-work.ja.md#ctxwaituntil)
- セッション: [mix-session](../packages/mix-session/README.ja.md)・CSRF 対策: [mix-csrf](../packages/mix-csrf/README.ja.md)・セキュリティヘッダー: [mix-secure-headers](../packages/mix-secure-headers/README.ja.md)・CORS: [mix-cors](../packages/mix-cors/README.ja.md)
- 静的ファイル: [mix-static](../packages/mix-static/README.ja.md)・リクエストのログ: [mix-logger](../packages/mix-logger/README.ja.md)・圧縮: [mix-compress](../packages/mix-compress/README.ja.md)

## 調べる

- [コンポーネント](../packages/mixer/README.ja.md#コンポーネント)と [ctx](../packages/mixer/README.ja.md#ctx)
- [返せる値](../packages/mixer/README.ja.md#返せる値)と [Response を返す](../packages/mixer/README.ja.md#response-を返す)
- [エラー](../packages/mixer/README.ja.md#エラー)と[エラーの報告](../packages/mixer/README.ja.md#エラーの報告)
- [Cookie](../packages/mixer/README.ja.md#cookie)・[リダイレクト](../packages/mixer/README.ja.md#リダイレクト)・[型](../packages/mixer/README.ja.md#型)
- [Mixer のオプション](../packages/mixer/README.ja.md#オプション)と [basePath](../packages/mixer/README.ja.md#basepath)

## 設計を理解する

- [何もしなくても安全](explanation/safety.ja.md): 追加のコードなしで mixer が正しく扱うもの
- [next() で包む](explanation/composition.ja.md): コンポーネントの組み立て方
- [設計判断の記録（ADR）](adr): なぜこの設計なのか

## 開発に参加する

- [CONTRIBUTING.md](../CONTRIBUTING.md): 準備、コマンド、テスト、設計の原則、コード規約
- [AGENTS.md](../AGENTS.md): このリポジトリで作業する AI エージェントへの指示
