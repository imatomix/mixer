# @imatomix/mix-session

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mix-session/README.ja.md)

Server-side sessions for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer). The cookie holds only a random ID, and nothing is created until you write.

- Runs on Node.js, Bun, and Cloudflare Workers (on Workers and other serverless platforms, with an external store)
- At 0.x, so the API may change between minor versions

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-session
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { type SessionState, session } from '@imatomix/mix-session'
import { get, post } from '@imatomix/mix-router'

type Data = { user: string }

const app = new Mixer<SessionState<Data>>()

app.mix(
  session<Data>(),
  post('/login', async (ctx) => {
    // ...once authentication succeeds
    ctx.state.session.regenerate() // always issue a new ID on login
    ctx.state.session.set('user', 'imatomix')
    return 'ok'
  }),
  get('/me', (ctx) => ctx.state.session.get('user') ?? null),
  post('/logout', (ctx) => {
    ctx.state.session.destroy()
    return 'bye'
  }),
)
```

## How it works

- The cookie holds **only a 32-byte random ID**, and the data lives in a server-side store. The data never reaches the browser, so it is not encrypted
- **No session is created until something is written.** Visiting alone creates nothing in the store or in cookies
- Only when something changed, the session is saved to the store and the cookie is issued right before the response (`ctx.onBeforeSend`). A change made inside a value, such as `session.get('cart').push(item)`, counts too
- Responses that send Set-Cookie get `Cache-Control: private, no-store` (so shared caches never hand the same session to other users)
- Sessions are saved for every response, including a `Response` returned by a component, `404`, and error responses
- Session IDs come from Web Crypto (`crypto.getRandomValues`)

## API

`ctx.state.session` (`Session`)

| Method | Description |
| --- | --- |
| `get(key)` / `set(key, value)` / `delete(key)` | Read and write data. Deleting every key is the same as `destroy()` |
| `regenerate()` | Issues a new ID while keeping the data, and deletes the old ID from the store. **Always call it when privileges change, such as on login** (protection against session fixation) |
| `destroy()` | Deletes the session from the store and removes the cookie |
| `id` | ID of the loaded session. `undefined` for a new session until it is saved |

## Options

| Option | Default | Description |
| --- | --- | --- |
| `store` | `new MemoryStore()` | Where sessions are stored |
| `name` | `'__Host-sid'` ([see below](#cookie-name)) | Cookie name |
| `ttl` | `86400` | Lifetime in seconds. Used for the cookie's Max-Age and the store's expiry |
| `rolling` | `false` | Extend the expiry even on requests that only read the session |
| `cookie` | mixer's defaults (HttpOnly, Secure, SameSite=Lax, Path=/) | Cookie attributes. Use `{ secure: false }` when developing on http://localhost |

## Stores

```ts
interface SessionStore {
  get(id: string): Promise<SessionData | undefined>
  set(id: string, data: SessionData, ttlSeconds: number): Promise<void>
  /** Updates only if the session exists, and returns false otherwise. The check and the update must be atomic */
  update(id: string, data: SessionData, ttlSeconds: number): Promise<boolean>
  delete(id: string): Promise<void>
}
```

`update` works "only if it exists" so that a concurrent request holding an old ID cannot bring back a session right after `destroy()` or `regenerate()`.

`MemoryStore` keeps sessions in process memory. It never returns expired sessions, and drops the least recently used ones when `maxEntries` (default 10000) is exceeded.
To run multiple processes, or to keep sessions across restarts, implement an external store and pass it in. On serverless platforms and Cloudflare Workers, where each request may run in a different instance, always use an external store. Its `update` must check and update in one step (for example, a D1 transaction or a Durable Object); Workers KV does not fit, because its writes take time to reach other locations.

## Cookie name

By default the cookie gets the strongest name prefix your options allow, so that an attacker cannot plant a session ID of their choosing from another subdomain or an http page:

| Options | Default name | Who cannot overwrite the cookie |
| --- | --- | --- |
| Defaults | `__Host-sid` | Other subdomains and http pages |
| `cookie: { domain: 'example.com' }` (share across subdomains), or a `path` other than `/` | `__Secure-sid` | http pages |
| `cookie: { secure: false }` (http development) | `sid` | Nobody; use only for development |

To share a session across subdomains, set `domain`; that is all. A `name` you pass is used as is, and combinations that browsers reject (such as `__Host-` with a `domain`) make `session()` throw.

## Invalid IDs

- An ID that is not in the store (expired or forged) is never adopted; a new ID is issued on write
- Malformed IDs, and multiple cookies with the same name (possibly planted from a subdomain), are not loaded

