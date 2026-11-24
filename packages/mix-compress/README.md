# @imatomix/mix-compress

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mix-compress/README.ja.md)

Response compression for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer), for apps that Node.js or Bun serve directly.

- Runs on Node.js and Bun. On Cloudflare Workers, and behind a CDN or a proxy that compresses (nginx, Caddy, most platforms), you do not need it
- At 0.x, so the API may change between minor versions

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-compress
```

## Usage

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { compress } from '@imatomix/mix-compress'

const app = new Mixer()

app.mix(compress(), () => ({ items: [] }))

await serve(app, { port: 3000 })
```

Mix it in early: it compresses the responses of everything mixed in after it. Brotli or gzip is chosen from the client's `Accept-Encoding`.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `minBytes` | `1024` | A body whose length is known and shorter than this is sent as it is |
| `allowCredentialed` | `false` | Also compress responses to requests that carry `Cookie` or `Authorization` ([why it is off](#signed-in-pages)) |
| `filter` | none | `(ctx, response) => boolean`; return `false` to send a response uncompressed |

A single response can also opt out with `Cache-Control: no-transform`.

## Signed-in pages

By default, a request that carries `Cookie` or `Authorization` gets its response uncompressed. A compressed response that contains both a secret (a token, personal data) and text an attacker can influence (a search term, a name from a URL) can reveal the secret through its size (the BREACH attack), and signed-in pages are where the two usually meet.

Turn on `allowCredentialed` after checking that your signed-in pages do not put secrets next to text a third party can influence, or leave such pages out with `filter`.

```ts
app.mix(
  compress({
    allowCredentialed: true,
    filter: (ctx) => !ctx.path.startsWith('/account'),
  }),
)
```

## What is compressed

Text, JSON, XML, JavaScript, SVG, and similar types, with a body. These are sent as they are:

- `HEAD` requests, and `204`, `205`, `206`, and `304` responses, and responses with `Content-Range`
- Responses that already have a `Content-Encoding`, such as mix-static's [precompressed files](https://github.com/imatomix/mixer/blob/main/packages/mix-static/README.md#precompressed-files)
- `text/event-stream` (mixer's [`sse()`](https://github.com/imatomix/mixer/blob/main/docs/how-to/streaming-and-background-work.md#server-sent-events)), which must reach the client event by event
- Responses with an `ETag`, whose validator would no longer match the compressed body
- Images, video, archives, and other types that do not shrink
- A known length below `minBytes`. A `Response` the app builds, such as `Response.json()`, has no known length, so it is compressed whatever its size

A compressed response gets `Content-Encoding` and loses `Content-Length`. Every response that could be compressed gets `Vary: Accept-Encoding`, and `Cookie, Authorization` while `allowCredentialed` is off, because those request headers decide whether it is compressed. That lowers the hit rate of a shared cache in front, which is one more reason to let a CDN compress when you have one.

## Streams

A streamed response is compressed as it is produced. Chunks the stream has ready are compressed together, and what has been compressed is sent whenever the stream has to wait, so a page that streams its HTML still arrives piece by piece. A proxy in front may buffer it anyway.

When the client goes away, the stream is cancelled.
