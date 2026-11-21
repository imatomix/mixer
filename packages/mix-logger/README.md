# @imatomix/mix-logger

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mix-logger/README.ja.md)

Request logger for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer).

> **Note:** This package is at 0.x, so the API may change between minor versions.

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-logger
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { logger } from '@imatomix/mix-logger'

const app = new Mixer()

app.mix(logger(), () => 'Hello Mixer')

await serve(app, { port: 3000 })
```

```
2026-11-21T00:00:00.000Z GET /hello 200 1.2ms 11B
```

The duration is measured from when the logger runs, so mix it in **as early as possible**.
Each request is recorded once, when the final `Response` is ready (through `ctx.onResponse`).

## Changing the output

`write` receives a structured entry (`LogEntry`), so you can output JSON or send entries elsewhere.

```ts
app.mix(
  logger({
    write: (entry) => {
      console.log(JSON.stringify(entry))
    },
  }),
)
```

| Property | Description |
| --- | --- |
| `time` | When the request was received (`Date`) |
| `method` | The HTTP method |
| `path` | The path, including `basePath` (**without the query**) |
| `status` | The status code |
| `responseDurationMs` | Milliseconds from when the logger ran until the `Response` was ready. **Sending the body is not included** |
| `contentLength` | Value of the response's `Content-Length` header. `undefined` when the length is unknown, such as for streams |

`formatLogEntry(entry)` converts an entry to the default one-line format, which is written with `console.log`.

If `write` returns a Promise, the response does not wait for it: it is passed to `ctx.waitUntil`. On platforms that may stop after the response, pass the platform's background-work API to `app.fetch` so that the write is not cut off (see [mixer's `ctx.waitUntil()`](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.md#ctxwaituntil)).

## Safety

- The query is not recorded, because both keys and values can contain tokens or email addresses
- The default format escapes control characters such as newlines and escape sequences, so fake lines or colors cannot be injected into the log (handle this yourself when writing a custom format with `write`)
- If `write` throws or its Promise rejects, the error is only reported with `console.error`; the response and the server are not affected

## Migrating from v0.1

| v0.1 | v0.2 |
| --- | --- |
| `durationMs` (until the response was sent) | `responseDurationMs` (until the `Response` was ready; sending is not included) |
| `aborted` | Removed: a Web standard handler cannot see whether the client went away while the body was sent |
| Written with `process.stdout.write` | Written with `console.log` (the same line) |

## Migrating from v0.0.x

| v0.0.x | v0.1 |
| --- | --- |
| `const logger = require('mix-logger')` | `import { logger } from '@imatomix/mix-logger'` |
| `new mixer(logger)` | `app.mix(logger())` (now called as a function) |
| Durations of concurrent requests were mixed up | Measured per request |
| Memory usage was printed | Not printed |
| The URL was printed with its query | Path only |
