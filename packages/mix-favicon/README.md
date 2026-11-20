# mix-favicon
Serve favicon

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Overview
ブラウザからの ```favicon.ico``` へのリクエストに favicon を返す。

## Usage

```./favicon.ico``` を使用する時

```js
const mixer = require('mixer')
const favicon = require('mix-favicon')

const app = new mixer(favicon())

app.listen(3000)
```

favicon ファイルのパスを直接指定する時
```js
const mixer = require('mixer')
const favicon = require('mix-favicon')

const app = new mixer(favicon('./images/favicon.ico'))

app.listen(3000)
```


## ToDo
勉強中
- オプション機能とか
- エラーハンドリング
- テスト

## mix modules

- [mixer](https://github.com/imatomix/mixer) : サーバー処理
- [mix-router](https://github.com/imatomix/mix-router) : ルーティング機能
- [mix-static](https://github.com/imatomix/mix-static) : 静的ファイルのサーブ
- [mix-cors](https://github.com/imatomix/mix-cors) : cors処理
- mix-csrf : csrf処理（作ろうかな）
