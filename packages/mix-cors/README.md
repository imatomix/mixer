# mix-cors

cors for [mixer](https://github.com/imatomix/mixer)

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Usage

```js
const mixer = require('mixer')
const cors = require('mix-cors')

const app = new mixer(cors())

app.mix(() => 'cors is mixed!').listen(3000)
```

- option設定時

```js
const mixer = require('mixer')
const cors = require('mix-cors')

const app = new mixer(cors({
  allowMethods: ['GET', 'POST', 'PUT']
}))

app.mix(() => 'cors is mixed!').listen(3000)
```

### Options

#### allowMethods
default: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']

#### allowHeaders
default: ['Accept','Content-Type']

#### allowCredentials
default: true

#### exposeHeaders
default: null

#### maxAge
default: 86400 // 24hours 

#### origin
default: *

## ToDo
勉強中
- エラーハンドリング
- README書く
- テスト

## mix modules

- [mixer](https://github.com/imatomix/mixer) : サーバー処理
- [mix-router](https://github.com/imatomix/mix-router) : ルーティング機能
- [mix-static](https://github.com/imatomix/mix-static) : 静的ファイルのサーブ
- [mix-favicon](https://github.com/imatomix/mix-favicon) : faviconのサーブ
- [mix-logger](https://github.com/imatomix/mix-logger) : logger
- mix-csrf : csrf処理（作ろうかな）
