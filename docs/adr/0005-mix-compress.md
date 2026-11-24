# 0005. Compress responses with an opt-in mix-compress

- Status: Accepted
- Date: 2026-11-24

## Context

mix-static already serves precompressed `.br` and `.gz` files with ETags and `304`. Responses that handlers build (HTML, JSON) are sent uncompressed. Behind Cloudflare, most platforms, nginx, or Caddy, the layer in front compresses them; an app that Node.js or Bun serves directly, which is common for small apps, sends them as they are.

Compressing is not free of risk. BREACH: when a response compressed over HTTPS contains both a secret (a token, personal data) and input an attacker can influence, the compressed size can reveal the secret. Whether a response is `private` or `no-store` says nothing about that.

Since composing with `await next()` ([ADR 0001](0001-compose-components-with-next.md)), a component can wrap the response that later components return, so compression fits as a module.

## Options

- **Where:** a new package, or in mixer. Compression is a feature an app chooses, not a format mixer must get right (like cookies, `redirect()`, or `sse()`), so it is a package that is off unless mixed in.
- **What to do about BREACH by default:**
  - **P.** Do not compress responses to requests that carry `Cookie` or `Authorization`, unless the app turns it on.
  - **Q.** Compress everything and warn in the README.
- **What compresses:** the Web standard `CompressionStream`, which runs everywhere, or `node:zlib`, which runs on Node.js and Bun.

## What we found

- The presence of `Cookie` or `Authorization` is an imperfect sign of secrets: it does not protect a token on a page for visitors who are not signed in, and an analytics cookie stops compression of a public page. Looking at `Set-Cookie` on the response or at `ctx.state` catches less.
- A `Response` the app builds, even `Response.json()` or `new Response(text)`, has no `Content-Length`, and nothing tells a one-shot body from a live stream.
- `CompressionStream` cannot flush. On Node.js 26 and Bun 1.4.4, two chunks written 200 ms apart came out only when the stream closed, so a streamed page would arrive only at its end. Skipping bodies of unknown length avoids that but also skips every `Response.json()`.
- Other frameworks compress bodies of unknown length by default. Those built on zlib let a stream flush; the one built on `CompressionStream` leaves the delay to the app.
- `node:zlib` flushes: on Node.js 26 and Bun 1.4.4, gzip with `Z_SYNC_FLUSH` and Brotli with `BROTLI_OPERATION_FLUSH` sent each chunk right after it was written, and the output decompressed correctly. Cloudflare compresses at the edge, so the package is not needed on Workers, and mix-static is already for Node.js and Bun only.
- Weakening a strong ETag with `W/` when compressing can disagree with how the app answers `If-None-Match`, so a response with an ETag is left alone for now.

## Decision

`compress(options)` in `@imatomix/mix-compress`, for Node.js and Bun, with `node:zlib` (built in, so no dependency).

- **Encodings:** Brotli (quality 4, as the default of 11 is too slow for responses built on each request) and gzip, chosen by the `Accept-Encoding` weights; Brotli on a tie. `q=0` excludes an encoding even when `*` would allow it, a higher weight for `identity` keeps the response uncompressed, and no `Accept-Encoding` means no compression. When nothing fits, the response is sent as it is, never `406`. zstd is left out while it is experimental in Node.js.
- **Streams:** chunks the source has ready are compressed together, and the output is flushed whenever the source has to wait, or after 64 KB of input (a single larger chunk is not split), so a streamed body arrives as it is produced. Whether the source has to wait is judged by racing its next read against a 0 ms timer: a heuristic that costs up to about a millisecond per pause, not an exact signal. Bodies of unknown length are compressed like any other. Flushing every chunk instead made a stream of 2000 small rows about three times the size of compressing it in one go (28 KB against 10 KB); batching brought it to the same size.
- **P by default:** `allowCredentialed: false` skips requests with `Cookie` or `Authorization`. An app that has checked its signed-in pages turns it on. `filter(ctx, response)` and `Cache-Control: no-transform` leave out single responses.
- **Skipped:** `HEAD`; responses without a body and `204`, `205`, `206`, `304`; a `Content-Range`; an existing `Content-Encoding` (mix-static's precompressed files); `no-transform`; `text/event-stream`; types that do not shrink (only text, JSON, XML, JavaScript, SVG, and similar are compressed); responses with an `ETag`; a known `Content-Length` below `minBytes` (1024).
- **When compressing:** `Content-Encoding` is set and `Content-Length` removed.
- **`Vary`:** a response that could be compressed gets `Vary: Accept-Encoding`, and `Cookie, Authorization` while `allowCredentialed` is off, whether or not this request got it compressed, because those headers decide it.

## Consequences

- An app served directly gets smaller public pages and APIs by mixing in one component; signed-in pages stay uncompressed until the app decides otherwise.
- A stream that pauses often is flushed often, which costs some ratio, and a proxy in front may still buffer. `minBytes` cannot apply to a body of unknown length, so a tiny one can grow slightly.
- `Vary: Cookie` lowers the hit rate of a shared cache. A setup with a CDN in front lets the CDN compress and does not need this package; the README says it is for Node.js and Bun serving directly, not for Workers.
- Responses with ETags are not compressed; that can become an option when a need is clear.
