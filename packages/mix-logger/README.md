# @imatomix/mix-logger

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mix-logger/README.ja.md)

Request-scoped logs for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer). Every request gets an ID, and everything logged while handling it carries that ID: the access line, what your handlers write, and unexpected errors with their stack.

- Runs on Node.js, Bun, and Cloudflare Workers
- At 0.x, so the API may change between minor versions

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-logger
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { type LoggerState, logger } from '@imatomix/mix-logger'
import { createRouter } from '@imatomix/mix-router'

const { post } = createRouter<LoggerState>()
const app = new Mixer<LoggerState>()

app.mix(
  logger(),
  post('/todos', async (ctx) => {
    const todo = await saveTodo(await ctx.body())
    ctx.state.log.info('created', { todoId: todo.id })
    return todo
  }),
)

await serve(app, { port: 3000 })
```

Each event is one JSON line:

```
{"todoId":7,"level":"info","kind":"app","requestId":"6f1c…","method":"POST","path":"/todos","message":"created","time":"2026-11-23T00:00:00.000Z"}
{"level":"info","kind":"access","requestId":"6f1c…","method":"POST","path":"/todos","status":200,"durationMs":3.1,"contentLength":42,"time":"2026-11-23T00:00:00.000Z"}
```

When a handler throws, the error event has the same `requestId`, so you can find what happened from the access line, or from the ID a user reports:

```
{"level":"error","kind":"error","requestId":"9a2e…","method":"POST","path":"/todos","phase":"handling","error":{"name":"TypeError","message":"…","stack":"…"},"time":"…"}
```

Mix it in **first**: the duration is measured from when it runs, and errors from later components reach it. Errors that `onError` turned into a response, failing hooks, and rejected `ctx.waitUntil()` work are recorded too (through mixer's [`ctx.onErrorReport`](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.md#error-reports)). An `HttpError` below `500` is not an error event; the access event shows its status.

## In handlers

`ctx.state.log` has `debug`, `info`, `warn`, and `error`, each taking a message and optional fields, and `requestId` for showing to users or passing to other services. Give the app and the routes the `LoggerState` type to use it: `new Mixer<LoggerState>()` and, with mix-router, `createRouter<LoggerState>()` (routes cannot take the type from the app). Combine it with other state as `LoggerState & SessionState`.

## Options

```ts
logger({
  write: 'text',
  requestId: (ctx) => ctx.request.headers.get('cf-ray') ?? undefined,
  header: 'X-Correlation-Id',
})
```

| Option | Default | Description |
| --- | --- | --- |
| `write` | `'json'` | `'json'` writes one JSON object per line and `'text'` one readable line, through `console.log` (`console.error` for events at the `error` level, including `ctx.state.log.error`). A function receives each `LogEvent` instead |
| `requestId` | a new random UUID | `(ctx) => string \| undefined` to take the ID from the request, such as Cloudflare's `CF-Ray`. Use only a header that your platform or proxy sets and clients cannot: on Node.js or Bun without Cloudflare in front, anyone can send `CF-Ray`. A missing or malformed value (anything but 1 to 128 of `A-Z a-z 0-9 . _ : -`) gets a new random ID |
| `header` | `'X-Request-Id'` | Response header that carries the ID, or `false` for none. It replaces a value a handler set in `ctx.headers`, so the response matches the logs. A `Response` returned with its own value (for example, passed through from another service) keeps that value, which then differs from the logs |

`'text'` is easier to read while developing:

```
2026-11-23T00:00:00.000Z INFO POST /todos created {"todoId":7} 6f1c…
2026-11-23T00:00:00.000Z INFO POST /todos 200 3.1ms 42B 6f1c…
```

### Sending events elsewhere

A `write` function receives a `LogEvent` object, so you can hand events to pino, OpenTelemetry, or a log service without mix-logger depending on them. If it returns a Promise, the response does not wait for it: it is passed to `ctx.waitUntil`. On platforms that may stop after the response, pass the platform's background-work API to `app.fetch` so that the write is not cut off (see [mixer's `ctx.waitUntil()`](https://github.com/imatomix/mixer/blob/main/packages/mixer/README.md#ctxwaituntil)).

| Property | Events | Description |
| --- | --- | --- |
| `time` | all | `Date` |
| `level` | all | `'debug'`, `'info'`, `'warn'`, or `'error'` |
| `kind` | all | `'access'`, `'app'`, or `'error'` |
| `requestId`, `method`, `path` | all | The request. `path` includes `basePath` and **leaves out the query** |
| `message`, `fields` | `app` | What the handler passed |
| `status`, `durationMs`, `contentLength` | `access` | `durationMs` is until the `Response` was ready (**sending the body is not included**); `contentLength` is left out when unknown, such as for streams |
| `phase`, `error` | `error` | Where it happened, and `{ name, message, stack }` |

`formatLogEvent(event)` returns the `'text'` line.

## Safety

- The query is not recorded, because both keys and values can contain tokens or email addresses
- Incoming `X-Request-Id` headers are ignored unless you choose them with `requestId`, because clients can send any value and confuse which logs belong together
- JSON output escapes line breaks and control characters, and the text output escapes them too, so a request cannot forge log lines or colors. In `'text'`, only the stack frames of an error keep their line breaks; they come from your code, not from the request
- A handler's fields cannot replace `requestId`, `level`, or the other fixed properties in the JSON output. Fields JSON cannot hold, such as circular objects, are dropped instead of failing; BigInts are written as strings and Errors with their name, message, and stack
- If `write` throws or its Promise rejects, the error is only reported with `console.error`; the response and the server are not affected

## Limits

- Only what goes through `ctx.state.log` or mixer's error reports carries the ID. A `console.log` inside a handler does not
- An error inside a response stream after it has started is not seen by mixer
- The `404` for a path outside `basePath` is answered before any component runs, so it is not logged
