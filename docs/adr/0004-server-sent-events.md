# 0004. Send Server-Sent Events with sse()

- Status: Accepted
- Date: 2026-11-24

## Context

A handler can already return a `ReadableStream`, so an app can send Server-Sent Events by writing the format itself. Doing that safely takes more than it looks:

- The format is line-based. A value with a line break, such as a chat message from a client, written into `data:` as it is can end the event and start a forged one (`\n\nevent: admin\ndata: ...`), the same kind of problem as header injection.
- Connections that send nothing are closed: Bun closes them after 10 seconds by default, and proxies after their own idle timeouts. A long-lived stream needs to send something regularly.
- The stream has to stop when the client goes away, and an error after the response has started cannot become an error response.

mixer already keeps formats safe in core: `redirect()` encodes `Location`, and cookies reject values that would break the header.

## Options

1. **A.** Documentation only: show how to write events into a `ReadableStream`.
2. **B.** A small `sse()` in mixer that returns a `Response`, like `redirect()`, and owns the format, the headers, a heartbeat, and stopping.
3. **C.** A separate package.

## What we tried

- **A wrapper that only turns a stream into a response does not stop injection.** The protection has to be where each field is written.
- **C would have to rebuild what Context already has**: reporting errors through `ctx.onErrorReport()` and knowing when the client has gone.
- **The common shape is a callback with a stream object.** Other helpers split multi-line `data` into several `data:` lines and reject line breaks in `event` and `id`; some serialize objects to JSON, some take strings only; heartbeats are off, or on with a long interval.

## Decision

Use B: `sse(ctx, async (stream, signal) => { await stream.send({ event, data, id, retry }) }, options?)`.

- `data` is a string; each of its lines becomes a `data:` line, so client text cannot start another event. Objects are not serialized implicitly: `JSON.stringify` keeps the format visible. `event` and `id` with a line break or NUL, and a `retry` that is not a whole number of milliseconds, throw.
- The producer starts when the body is first read, so `HEAD` and responses whose body is discarded never run it.
- `send` resolves when the client is ready for more, so at most one event waits in memory and a fast producer does not fill it.
- When nothing has been sent for 5 seconds, a comment line is sent. This keeps Bun (10 seconds) and proxies from closing the connection, without a setting in any adapter. `heartbeat: false` turns it off, and a number changes the interval. No comment is added while something sent is still unread, so a client that stopped reading does not make the queue grow.
- When the client goes away (the body is cancelled, or `ctx.request.signal` is aborted), `signal` is aborted, the heartbeat stops, and later `send` calls reject, so a loop that ignores `signal` still ends.
- An error the producer throws after the response has started is reported once with the new phase `'stream'`, and the stream is closed; an error after the client went away is not reported.
- Headers: `Content-Type: text/event-stream; charset=utf-8` and `Cache-Control: no-store`. No `Connection` header, which HTTP/2 forbids, and no `Content-Length`.

## Consequences

- Core takes on timers, cancellation, and errors after the response has started. They are tested once in core instead of being written by each app.
- A heartbeat every 5 seconds is shorter than others use; it is a few bytes and covers every runtime with one rule.
- mix-logger measures the time until the response starts, not until the stream ends.
- A compression module must leave `text/event-stream` responses alone.
- On Cloudflare Workers, a disconnect reaches the Worker only from compatibility date `2026-11-17` or with the `enable_request_signal` flag. Without it, on workerd at `2026-07-30`, neither `ctx.request.signal` nor the body was cancelled after the client left: the producer stopped at its next `send`, which waits for a read that never comes, but `signal` was not aborted, so its clean-up did not run. The README tells Workers apps that send events to use the flag or a newer date.
