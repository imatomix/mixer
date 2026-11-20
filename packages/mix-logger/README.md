# mix-logger
logger for [mixer](https://github.com/imatomix/mixer)

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Overview
アクセスに対するコンソールへのログ出力

## Usage

```js
const mixer = require('mixer')
const logger = require('mix-logger')

const app = new mixer(logger())

app.mix(
  (req, res) => {
    res.statusCode = 200
    res.end(req.url)
  }).listen(3000)
```

## ToDo
勉強中
- ファイル出力とか？
- テスト

## mix modules

- [mixer](https://github.com/imatomix/mixer) : サーバー処理
- [mix-router](https://github.com/imatomix/mix-router) : ルーティング機能
- [mix-static](https://github.com/imatomix/mix-static) : 静的ファイルのサーブ
- [mix-favicon](https://github.com/imatomix/mix-favicon) : faviconのサーブ
- [mix-cors](https://github.com/imatomix/mix-cors) : cors処理
- mix-csrf : csrf処理（作ろうかな）
