# mixer

node.js と http 周りの勉強でちまちま作ってます。

## Usage
基本はhttpモジュールと同じように使える
```js
const mixer = require('mixer')
const app = new mixer((req, res) => {
  res.post(200, 'Hello Mixer')
})

app.listen(3000)
```

### mix()

mix()で、リクエスト時の処理を足す。
```js
const mixer = require('mixer')
const app = new mixer()

app.mix((req, res) => {
  res.post(200, 'Hello Mixer')
})

app.listen(3000)
```

繋げてもいいし
```js
app.mix(fn).mix(fn).mix(fn).listen(3000)
```
一つのmixに複数の関数を入れてもいい
```js
app.mix(fn, fn, fn).listen(3000)
```

### async/await
async/awaitを使って3秒後にレスポンスを返す。

```js
const mixer = require('mixer')

const sleep = (msec) => new Promise(resolve => setTimeout(resolve, msec))

const app = new mixer(async (req, res) => {
  await sleep(3000)
  res.post(200, 'Hello Mixer')
})

app.listen(3000)
```

### Nuxt.js

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

const app = new mixer(nuxt.render)

app.listen(3000)

```

