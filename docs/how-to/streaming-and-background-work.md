# Streaming and background work

English | [日本語](streaming-and-background-work.ja.md)

Send events as they happen, keep slow work from hanging, and run work after the response.

## Server-Sent Events

`sse()` answers with a stream of events. Each field is written safely: every line of `data` becomes its own `data:` line, so text from a client cannot end the event and start a forged one, and `event` or `id` with a line break throws.

```ts
import { sse } from '@imatomix/mixer'

get('/events', (ctx) =>
  sse(ctx, async (stream, signal) => {
    while (!signal.aborted) {
      const update = await nextUpdate(signal)
      await stream.send({ event: 'update', id: update.id, data: JSON.stringify(update) })
    }
  }),
)
```

- `data` is a string; use `JSON.stringify` for other values. `retry` is the client's reconnection delay in milliseconds
- `signal` is aborted when the client goes away. After that, `send` rejects, so a loop that ignores `signal` still ends
- `send` resolves when the client is ready for more, so a producer that awaits each `send` keeps at most one event waiting in memory
- A comment line is sent when nothing was sent for 5 seconds, so Bun (which closes idle connections after 10 seconds) and proxies keep the connection open. `sse(ctx, producer, { heartbeat: 15_000 })` changes the interval, and `heartbeat: false` turns it off
- The response is `text/event-stream; charset=utf-8` with `Cache-Control: no-store`. Headers and cookies set on `ctx` before it are kept; behind nginx, set `X-Accel-Buffering: no` so it does not buffer the stream
- The producer starts when the client reads the body, so a `HEAD` request never runs it
- The response has started when the producer runs, so an error it throws cannot become an error response: it is [reported](../../packages/mixer/README.md#error-reports) with the phase `'stream'`, and the stream ends. The browser's `EventSource` then reconnects, sending the last `id` it received in `Last-Event-ID`
- On Cloudflare Workers, use compatibility date `2026-11-17` or later, or the `enable_request_signal` flag. Before that, the Worker is not told when the client goes away: the producer stops at its next `send`, but `signal` is not aborted

## Slow work

mixer has no time limit for a whole route. JavaScript cannot stop work that is running, so answering early would leave it running, and a write could still be saved after the client was told it failed. Put a limit on each call that goes out instead, so that the work itself stops:

```ts
get('/weather', async (ctx) => {
  const res = await fetch(WEATHER_API, {
    // Stops when the client goes away or after 5 seconds
    signal: AbortSignal.any([ctx.request.signal, AbortSignal.timeout(5_000)]),
  })
  return Response.json(await res.json())
})
```

- A stopped call throws, and the route answers `500` unless it catches the error
- Pass the same signal to other clients that take one, such as a database driver
- Stopping does not undo writes already made. Await work that must finish in the route, rather than handing it to `ctx.waitUntil()`: the client is not told whether that work succeeded, and platforms may cut it
- Clients that send slowly are handled by the adapters ([Node.js](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md#nodejs), [Bun](https://github.com/imatomix/mixer/blob/main/docs/how-to/runtimes.md#bun)) or the platform

## ctx.waitUntil()

Runs work after the response without making the response wait. On a long-running server (`serve()`, `Bun.serve`) the work finishes as the process keeps running, and a failure is [reported](../../packages/mixer/README.md#error-reports). On platforms that may stop after the response, pass the platform's background-work API as the third argument, as in `app.fetch(request, env, { waitUntil })`; on Cloudflare Workers, `export default app` does this for you.
