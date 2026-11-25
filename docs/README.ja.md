# mixer のドキュメント

[English](README.md) | 日本語

やりたいことから、どこに何があるかを探すための地図。

## 始める

- [すぐ始める](../packages/mixer/README.ja.md#すぐ始める): mixer を入れて、最初のリクエストに答える
- [おすすめの組み合わせ](../README.ja.md#おすすめの組み合わせ): ブラウザ向けのアプリと JSON API で組み合わせるモジュール
- [例のアプリ](../examples/todo): サインイン・セッション・CSRF 対策・セキュリティヘッダーを使った ToDo アプリ。Node.js・Bun・Cloudflare Workers で動く

## 例

- [JSON API](examples/json-api.ja.md): Zod で入力を確かめて、作る・一覧する・読む
- [Server-Sent Events でメッセージをリアルタイムに届ける](examples/live-messages.ja.md): 開いているブラウザすべてに、再接続にも対応して送る
- [Webhook を受け取る](examples/webhook.ja.md): 署名されたリクエストを、何かを信用する前に確かめる

## アプリを動かす

- [Node.js](how-to/runtimes.ja.md#nodejs)・[Bun](how-to/runtimes.ja.md#bun)・[Cloudflare Workers](how-to/runtimes.ja.md#cloudflare-workers)
- [React などの SPA と組み合わせる](how-to/spa.ja.md): API とビルドしたフロントを 1 つのアプリから配る
- Next.js・Nuxt・SvelteKit・React Router などの[フレームワークの中で使う](how-to/runtimes.ja.md#フレームワークの中で使う)
- [プロキシの後ろで使う](reference/mixer.ja.md#クライアントの-ip-アドレス): クライアントの IP アドレスと `trustedProxies`

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

- [コンポーネント](../packages/mixer/README.ja.md#コンポーネント)と [ctx](reference/context.ja.md#ctx)
- [返せる値](reference/responses.ja.md#返せる値)と [Response を返す](reference/responses.ja.md#response-を返す)
- [エラー](reference/responses.ja.md#エラー)と[エラーの報告](reference/responses.ja.md#エラーの報告)
- [Cookie](reference/responses.ja.md#cookie)・[リダイレクト](reference/responses.ja.md#リダイレクト)・[型](reference/mixer.ja.md#型)
- [Mixer のオプション](reference/mixer.ja.md#オプション)と [basePath](reference/mixer.ja.md#basepath)

## 設計を理解する

- [何もしなくても安全](explanation/safety.ja.md): 追加のコードなしで mixer が正しく扱うもの
- [next() で包む](explanation/composition.ja.md): コンポーネントの組み立て方
- [設計判断の記録（ADR）](adr): なぜこの設計なのか

## 開発に参加する

- [CONTRIBUTING.md](../CONTRIBUTING.md): 準備、コマンド、テスト、設計の原則、コード規約
- [AGENTS.md](../AGENTS.md): このリポジトリで作業する AI エージェントへの指示
- [llms.txt](../llms.txt): mixer でアプリを作るときに手伝う AI 向けの、要約と主なページ
