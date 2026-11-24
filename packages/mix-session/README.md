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
- Only when something changed, the session is saved to the store and the cookie is issued, after the rest of the app has run (`await next()`). A change made inside a value, such as `session.get('cart').push(item)`, counts too. Mix `session()` in before the components that use it, and after the ones that must stay cacheable
- Every response to a request with a session (one was loaded, or the response sets or clears its cookie) gets `Cache-Control: private, no-store`, replacing any other value, including on error responses and returned `Response`s. Such pages show one user's data, so no cache may keep them, and an accidental `public` cannot hand them to others. Mix in what should stay cacheable, such as static files, **before** `session()`. When saving fails, the error response carries the same policy, even when `onError` returns its own page
- Sessions are saved for every response, including a `Response` returned by a component, `404`, and error responses
- Session IDs come from Web Crypto (`crypto.getRandomValues`)

## API

`ctx.state.session` (`Session`)

| Method | Description |
| --- | --- |
| `get(key)` / `set(key, value)` / `delete(key)` | Read and write data. Deleting every key is the same as `destroy()` |
| `regenerate()` | Issues a new ID while keeping the data, and deletes the old ID from the store. **Always call it when privileges change, such as on login** (protection against session fixation). It also restarts the `absoluteTtl` clock |
| `destroy()` | Deletes the session from the store and removes the cookie |
| `id` | ID of the loaded session. `undefined` for a new session until it is saved |

## Options

| Option | Default | Description |
| --- | --- | --- |
| `store` | `new MemoryStore()` | Where sessions are stored |
| `name` | `'__Host-sid'` ([see below](#cookie-name)) | Cookie name |
| `ttl` | `86400` | Seconds a session lives without being saved again. Used for the cookie's Max-Age and the store's expiry |
| `rolling` | `false` | Extend the expiry even on requests that only read the session |
| `absoluteTtl` | `604800` (7 days) | Seconds after which a session ends however active it is. It restarts when a session is created or regenerated (such as on login). `false` turns it off |
| `cookie` | mixer's defaults (HttpOnly, Secure, SameSite=Lax, Path=/) | Cookie attributes. Use `{ secure: false }` when developing on http://localhost |
| `cacheControl` | `'private, no-store'` | Cache-Control for responses with a session. Another policy must include an unqualified `private` or `no-store` (without `=...`) and not `public` (such as `'private, max-age=60'`); `false` leaves caching to the app |

## Stores

Stores receive the value mix-session keeps, `{ createdAt, data }` (when the session was created, for `absoluteTtl`, and the session data); a value in any other shape is not adopted.

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

### Redis

`redisStore()` from `@imatomix/mix-session/redis` stores sessions in Redis. It has no dependency: pass a `send` function that sends one command with the client you already use and resolves with its reply.

```ts
import { session } from '@imatomix/mix-session'
import { redisStore } from '@imatomix/mix-session/redis'

app.mix(session({ store: redisStore({ send: (args) => client.sendCommand(args) }) }))
```

| Client | `send` |
| --- | --- |
| node-redis | `(args) => client.sendCommand(args)` |
| ioredis | `([command, ...rest]) => client.call(command, ...rest)` |
| Bun | `([command, ...rest]) => client.send(command, rest)` |

```ts
// Upstash REST (for Workers)
const send = async (args: string[]) => {
  const res = await fetch(env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
    body: JSON.stringify(args),
  })
  const { result, error } = await res.json()
  if (error) throw new Error(error)
  return result
}
```

| Option | Default | Description |
| --- | --- | --- |
| `send` | required | Sends one command and resolves with its reply; rejects on a Redis error |
| `prefix` | `'mix-session:'` | Prepended to every key |
| `hashKeys` | `true` | Store under a SHA-256 hash of the session ID |

- **Keys are hashes of session IDs by default.** A session ID is all it takes to use a session, so a key seen in a key listing, a monitoring tool, a log, or a backup would otherwise be enough to take one over. Set `hashKeys: false` only to share sessions with other software that reads the same keys, and then rely on keeping Redis private (network, ACLs, TLS)
- `sessionKey(id, { prefix, hashKeys })` gives the key for a session ID, for looking a session up by hand
- `update` uses `SET ... XX`, so a session deleted or expired meanwhile is not written back
- It follows `checkSessionStore()`, run against a real Redis in CI

### Checking your own store

`checkSessionStore()` from `@imatomix/mix-session/testing` runs the rules above against a store and throws an `Error` naming the first one it breaks. It is not tied to a test framework, and it uses fresh random IDs, so a shared store such as Redis can be checked:

```ts
import { checkSessionStore } from '@imatomix/mix-session/testing'

it('follows the session store rules', async () => {
  await checkSessionStore(() => myStore()) // add { expiry: false } to skip the two-second expiry check
})
```

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

