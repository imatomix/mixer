# Reading and validating the request body

English | [日本語](request-body.ja.md)

Read the body as JSON, a form, text, or bytes, check it with a schema, and set limits.

## Request body

Say which kind of body a route expects. Each reader accepts only its own Content-Type and answers `415` otherwise, before reading anything:

| Method | Accepts | Result |
| --- | --- | --- |
| `ctx.json()` | `application/json`, `application/*+json` | The parsed value as `unknown` (`400` if invalid or empty) |
| `ctx.form()` | `application/x-www-form-urlencoded`, `multipart/form-data` | `FormData`: `get(name)` and `getAll(name)` give strings, or `File`s for uploads (`400` if malformed) |
| `ctx.text()` / `ctx.bytes()` | anything | A string / a `Uint8Array` |

A JSON route therefore never parses a form or `text/plain`, which browsers send from other sites without asking first. That keeps a JSON route from being reached by a plain cross-site form, but it does not replace CSRF protection for routes that rely on cookies: use mix-csrf for those.

The values come from the client, so check them before use; `ctx.json()` returns `unknown` for that reason:

```ts
post('/todos', async (ctx) => {
  const form = await ctx.form()
  const title = form.get('title')
  if (typeof title !== 'string' || title.length === 0 || title.length > 200) {
    throw new HttpError(422, 'A title is between 1 and 200 characters')
  }
  // ...
})
```

With a schema library, check the value with `validateInput()`. It takes any [Standard Schema](https://standardschema.dev) (Zod 3.24 or later, Valibot, ArkType, ...) and resolves to the schema's output, typed:

```ts
import { validateInput } from '@imatomix/mixer'
import { z } from 'zod'

const NewItem = z.strictObject({ title: z.string().min(1).max(200), count: z.number().int() })

post('/api/items', async (ctx) => {
  const item = await validateInput(NewItem, await ctx.json()) // { title: string; count: number }
  // ...
})
```

- Data that does not match answers `422` with `{ "error": "Invalid request data" }`, and is not reported as a failure. Malformed JSON is still `400`, a wrong Content-Type `415`, and a body over the limit `413`
- The issues are kept off the response, because their messages can repeat the client's values. To show them, read `error.issues` in `onError`: `if (error instanceof ValidationError) return Response.json({ issues: error.issues }, { status: 422 })`
- A schema that throws instead of reporting issues is a bug, so it answers `500` and is reported
- Use it for values from the client only. Configuration or stored data that fails a check is the server's problem, not a `422`
- Have the schema reject or strip keys it does not know (`z.strictObject` above), so that keys such as `__proto__` do not travel further into the app
- It works on other input too: `Object.fromEntries(await ctx.form())` for form fields (one value per name; use `getAll` for repeated ones), `Object.fromEntries(ctx.url.searchParams)` for a query, and route parameters as they are

The body is read only when asked, and every reader returns the same content however many times it is called. The whole body is read into memory within `bodyLimit` (3 MB by default); streaming very large files to storage is not covered.

To change the limit for one route, pass `bodyLimit` where the route reads the body. The app's limit stays for every other route, so an upload route does not make the rest accept large bodies:

```ts
post('/photos', async (ctx) => {
  const form = await ctx.form({ bodyLimit: 50 * 1024 * 1024 }) // this route only
  // ...
})
post('/api/items', async (ctx) => {
  const item = await ctx.json({ bodyLimit: 64 * 1024 }) // smaller is fine too
  // ...
})
```

All four readers take it. The body is read once: a later read with a smaller `bodyLimit` checks the body already read against it, and a body refused by one read is not read again with a larger one. A proxy, CDN, or WAF in front can also cap request sizes, but the app's limit applies whether or not one is there.
