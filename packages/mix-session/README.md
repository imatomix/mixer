# mix-session
Minimal session storage for mixer https://github.com/imatomix/mixer

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Overview
セッションの作成と管理。
- セッションに保存されるデータは暗号化される。

## Usage

```js
const mixer = require('mixer')
const session = require('mix-session')

const app = new mixer(session({
  secret: 'your secret',
  name: 'session.id'
  cookie: {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30
  }
}))

app.mix(() => 'session is mixed!').listen(3000)
```

## ToDo
勉強中
- ちゃんとしたUUID生成
- メモリ以外へのストア
- 適切なエラーハンドリング
- テスト

## mix modules

- [mixer](https://github.com/imatomix/mixer) : サーバー処理
- [mix-router](https://github.com/imatomix/mix-router) : ルーティング機能
- [mix-favicon](https://github.com/imatomix/mix-favicon) : faviconのサーブ
- [mix-logger](https://github.com/imatomix/mix-logger) : logger
- [mix-cors](https://github.com/imatomix/mix-cors) : cors処理
- mix-csrf : csrf処理（作ろうかな）
