# mixer

Minimal & asynchronous web module.

デザイナーが node.js とサーバサイド周りの勉強にちまちま作ってます。
仕様は気紛れに変わります。

## Usage
基本は標準の ```http``` モジュールを参考に、コンストラクタへリクエストを受け取った時に実行する関数を入れることが出来る。

```js
const mixer = require('mixer')
const app = new mixer((req, res) => {
  res.send(200, 'Hello Mixer')
})

app.listen(3000)
```

値を返したいだけならこれでもいい。

```js
const mixer = require('mixer')
const app = new mixer(() => 'Hello Mixer'))

app.listen(3000)
```

### mix()

```mix()```で、リクエストを受け取った時に実行する関数を足すことが出来る。
```js
const mixer = require('mixer')
const app = new mixer()

app.mix(() => 'Hello Mixer'))

app.listen(3000)
```

関数は個別に ```mix()``` で繋げてもいいし、
```js
app.mix(fn).mix(fn).mix(fn).listen(3000)
```
一つの ```mix()``` に複数の関数を入れてもいい
```js
app.mix(fn, fn, fn).listen(3000)
```
先に ```mix()``` した関数順に処理されるので順番は大事。

### res.send()
リクエストに対してレスポンスを返すときは ```res.send()``` を使用する。
```js
res.send(200, 'Hello Mixer')
```
後述するが、 ```res.send()``` は Nuxt.js とバッティングして Nuxt.js が上手く動かなくなる。よってNuxt.js の前に ```delete res.send``` をしておく必要がある。なんかいい方法考える。


# Examples

### async/await
```async``` / ```await``` を使って3秒後にレスポンスを返す。

```js
const mixer = require('mixer')

const sleep = (msec) => new Promise(resolve => setTimeout(resolve, msec))

const app = new mixer(async (req, res) => {
  await sleep(3000)
  res.send(200, 'Good Morning Mixer')
})

app.listen(3000)
```

### Nuxt.js

```Nuxt.js``` を動かしてみる。

```js
const mixer = require('mixer')
const { Nuxt, Builder } = require('nuxt')

// Create nuxt instance with nuxt config
const config = require('../nuxt.config.js')
const nuxt = new Nuxt(config)
// Enable live build & reloading on dev
if (nuxt.options.dev) {
  new Builder(nuxt).build()
}

delete res.send
const app = new mixer(nuxt.render)

app.listen(3000)

```

## ToDo
勉強中
- エラーハンドリング
- 適切なヘッダ情報の添付
- テスト


## mix modules

- [mix-router](https://github.com/imatomix/mix-router) : ルーティング機能
- [mix-static](https://github.com/imatomix/mix-static) : 静的ファイルのサーブ
- [mix-logger](https://github.com/imatomix/mix-logger) : logger
- [mix-favicon](https://github.com/imatomix/mix-favicon) : faviconのサーブ
- [mix-cors](https://github.com/imatomix/mix-cors) : cors処理
- mix-csrf : csrf処理（作ろうかな）
