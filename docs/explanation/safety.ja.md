# 何もしなくても安全

[English](safety.md) | 日本語

追加のコードなしで mixer が正しく扱うものと、利用者に任せるもの。

設定しなくても、次のようになる。

- すべての応答に `X-Content-Type-Options: nosniff` が付く
- Cookie は `HttpOnly; Secure; SameSite=Lax; Path=/`。値はエンコードされ、ヘッダを注入できる名前・パス・ドメインは拒否される
- Cookie を付けた応答は、すでに `private` か `no-store` でなければ `Cache-Control: private` になり、共有キャッシュがほかの人に渡すことがない
- `HttpError` 以外のエラーは詳細なしの `500` になる。エラーの応答はヘッダを新しく作り直すので、通常の応答のための `Location`・`Cache-Control`・Cookie がエラーに紛れ込まない
- 3 MB を超えるリクエストボディを読むと `413`、壊れた JSON は `400` になる。`ctx.json()` と `ctx.form()` は自分の Content-Type だけを受け付ける（それ以外は `415`）ので、JSON のルートが別サイトのフォームを解析することはない
- `redirect()` は、ほかのオリジンを並べない限り、このサイトのパスにしか送らない
- `HEAD` の応答と `204` / `205` / `304` には本文が付かず、送らないストリームは止める
- `trustedProxies` を並べない限り `X-Forwarded-For` は無視するので、クライアントが `ctx.ip` を偽れない
- Node.js と Bun の `serve()` は `127.0.0.1` で待ち受け、ローカルのホスト名だけを受け付ける。DNS リバインディング（別のサイトのページが、自分のサーバーを指す名前を使って話しかけてくる攻撃）と、偽の `Host` ヘッダを防ぐ

アプリによって変わるものはモジュールに任せ、それぞれ 1 行で加える。CSRF 対策は [mix-csrf](https://github.com/imatomix/mixer/tree/main/packages/mix-csrf)、`X-Frame-Options`・`Referrer-Policy`・HSTS・CSP は [mix-secure-headers](https://github.com/imatomix/mixer/tree/main/packages/mix-secure-headers)。ブラウザにページを返すアプリは両方を加える。

もう 1 つ、mixer が代わりに決められないことがある。**メールやリダイレクトの絶対 URL を `ctx.url.host` から作らない。** `Host` ヘッダはクライアントが選ぶので、設定にあるオリジンを使う。
