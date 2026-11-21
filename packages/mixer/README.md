# mixer

English | [日本語](https://github.com/imatomix/mixer/blob/master/packages/mixer/README.ja.md)

Minimal & asynchronous web module.

- Written in TypeScript, ESM only, zero dependencies
- Node.js 24 or later, or Bun 1.4.4 or later

> **Note:** mixer is at 0.x, so the API may change between minor versions.

## Install

```sh
npm install @imatomix/mixer
```

## Usage

Add functions (components) that run on each request with `mix()`.
A component receives a single `ctx`, and the value it returns becomes the response.

```ts
import { Mixer } from '@imatomix/mixer'

const app = new Mixer()

app.mix(() => 'Hello Mixer')

await app.listen(3000)
```

### mix()

Chain `mix()` calls, or pass several functions to one `mix()`.

```ts
app.mix(fn).mix(fn).mix(fn)
app.mix(fn, fn, fn)
```

Components run in the order they were mixed in, and **stop at the first one that returns a value (anything other than `undefined`)**.
A component that returns nothing hands over to the next one. If no component responds, the response is `404`.

### ctx

| Property | Description |
| --- | --- |
| `ctx.req` / `ctx.res` | Node.js `IncomingMessage` / `ServerResponse` (mixer adds nothing to them) |
| `ctx.url` | The request URL as a `URL` object (`ctx.url.pathname`, `ctx.url.searchParams`) |
| `ctx.method` | The HTTP method |
| `ctx.status` | Status code used when responding with a return value (default `200`) |
| `ctx.state` | A place to pass values to later components |
| `await ctx.body()` | The body, parsed according to its Content-Type |
| `await ctx.text()` / `await ctx.buffer()` | The body as a string / Buffer |
| `ctx.send(status, body?)` | Respond immediately |
| `ctx.onBeforeSend(fn)` | Register work to run right before the response is sent (see below) |
| `ctx.cookies` | Read cookies and set Set-Cookie headers (see below) |

### Responses

The format is chosen from the type of the returned value (or the `body` passed to `ctx.send()`).
A `Content-Type` set earlier with `ctx.res.setHeader()` takes precedence.

| Value | Response |
| --- | --- |
| `string` | `text/plain; charset=utf-8` |
| `Buffer` / `Uint8Array` | `application/octet-stream` |
| `Readable` stream | Streamed as is (`application/octet-stream`) |
| Object, number, boolean | JSON (`application/json; charset=utf-8`) |
| `null` | `204 No Content` |

```ts
app.mix((ctx) => {
  ctx.status = 201
  return { created: true }
})
```

### ctx.onBeforeSend()

Registers work to run right before the response is sent. Hooks run in registration order and can change headers and `ctx.status`.
Use it to apply state that later components changed right before responding, such as a session cookie.

```ts
app
  .mix((ctx) => {
    ctx.onBeforeSend(() => {
      ctx.res.setHeader('Set-Cookie', serialize(ctx.state.session))
    })
  })
  .mix((ctx) => {
    ctx.state.session = { user: 'imatomix' }
    return 'ok'
  })
```

- Runs for responses from return values, `ctx.send()`, and error responses
- If a hook throws, the response is `500` (hooks are not run again)
- Does not run when a component responds by writing to `ctx.res` directly

### ctx.cookies

```ts
ctx.cookies.get('theme') // the first value if the name appears more than once
ctx.cookies.getAll('theme')
ctx.cookies.set('theme', 'dark', { maxAge: 60 * 60 * 24 })
ctx.cookies.delete('theme') // pass the same path / domain used when setting it
```

| Option | Default | Description |
| --- | --- | --- |
| `httpOnly` | `true` | Hide the cookie from JavaScript |
| `secure` | `true` | Send only over HTTPS. Set to `false` when developing on http://localhost |
| `sameSite` | `'Lax'` | `'Strict'` / `'Lax'` / `'None'` |
| `path` | `'/'` | |
| `maxAge` / `expires` / `domain` / `partitioned` / `priority` | none | |

- Values are URL-encoded when sent and decoded when read
- Setting the same name, path, and domain again in one response replaces the earlier value. Set-Cookie headers added in other ways are kept
- Names, paths, and domains that could inject headers, and combinations that browsers reject (such as `SameSite=None` without Secure, or `__Host-` with a Domain), throw a `TypeError`
- `set` / `delete` after the response has been sent throw

### Using ctx.res directly

Once a component writes headers to `ctx.res` directly, mixer treats the request as answered and does not run later components.
mixer does not call `end()` for you, because some responses keep writing, such as Server-Sent Events.
If you start writing, call `end()` yourself.

### Request body

`ctx.body()` reads the body only when needed, and returns the same result however many times it is called.

| Content-Type | Result |
| --- | --- |
| `application/json`, `*+json` | The value from `JSON.parse` (`400` if invalid) |
| `application/x-www-form-urlencoded` | `{ key: value }` (repeated keys become arrays) |
| `text/*` or none | A string |
| Anything else | A `Buffer` |
| Empty body | `undefined` |

Bodies over the limit (default 3 MB) get `413`.

```ts
const app = new Mixer({ bodyLimit: 1024 * 1024 })
```

### ctx.state and types

```ts
type State = { user?: string }

const app = new Mixer<State>()

app
  .mix((ctx) => {
    ctx.state.user = 'imatomix'
  })
  .mix((ctx) => `hello ${ctx.state.user}`)
```

### Error handling

Throwing an `HttpError` responds with its status and `{ "error": message }` (status must be 400–599).
Any other error becomes `500`, and the details are logged with `console.error` instead of being shown to the client.

```ts
import { HttpError, Mixer } from '@imatomix/mixer'

app.mix((ctx) => {
  if (!ctx.state.user) throw new HttpError(401, 'Unauthorized')
})
```

Replace error responses with `onError`. If `onError` does not respond, the default response is sent.

```ts
const app = new Mixer({
  onError: (error, ctx) => ctx.send(500, { message: 'Sorry' }),
})
```

### Server

```ts
const server = await app.listen(3000) // returns an http.Server
app.address // => { port: 3000, ... }
await app.close()
```

`app.handler` is `(req, res) => Promise<void>`, so it can be passed to your own `http` / `https` server.

```ts
import { createServer } from 'node:https'

createServer({ key, cert }, app.handler).listen(443)
```

# Examples

### async/await

```ts
import { setTimeout as sleep } from 'node:timers/promises'
import { Mixer } from '@imatomix/mixer'

const app = new Mixer().mix(async () => {
  await sleep(3000)
  return 'Good Morning Mixer'
})

await app.listen(3000)
```

### (req, res) handlers such as Nuxt.js

mixer does not modify `req` / `res`, so they can be passed through as is.

```ts
app.mix((ctx) => nuxt.render(ctx.req, ctx.res))
```

## Migrating from v0.0.x

| v0.0.x | v0.1 |
| --- | --- |
| `require('mixer')` | `import { Mixer } from '@imatomix/mixer'` |
| `new mixer(fn)` | `new Mixer().mix(fn)` |
| `(req, res) => {}` | `(ctx) => {}` (`ctx.req`, `ctx.res`) |
| `req.body` | `await ctx.body()` |
| `res.send(code, obj)` | `ctx.send(code, obj)` or `ctx.status = code; return obj` |
| `delete res.send` (for Nuxt.js) | No longer needed |

## Modules

Pick only the ones you need.

- [@imatomix/mix-router](https://github.com/imatomix/mixer/tree/master/packages/mix-router): type-safe router
- [@imatomix/mix-cors](https://github.com/imatomix/mixer/tree/master/packages/mix-cors): CORS
- [@imatomix/mix-static](https://github.com/imatomix/mixer/tree/master/packages/mix-static): static file serving
- [@imatomix/mix-session](https://github.com/imatomix/mixer/tree/master/packages/mix-session): server-side sessions
- [@imatomix/mix-logger](https://github.com/imatomix/mixer/tree/master/packages/mix-logger): access logging

## Development

Run `pnpm check` at the [repository root](https://github.com/imatomix/mixer/tree/master). See [CONTRIBUTING.md](https://github.com/imatomix/mixer/blob/master/CONTRIBUTING.md) for details.
