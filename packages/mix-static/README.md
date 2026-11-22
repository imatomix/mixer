# @imatomix/mix-static

English | [日本語](https://github.com/imatomix/mixer/blob/main/packages/mix-static/README.ja.md)

Static files for [mixer](https://github.com/imatomix/mixer/tree/main/packages/mixer), guarded against path traversal, dotfiles, and symbolic links that lead outside.

- Runs on Node.js and Bun (it reads files with `node:fs`; on Cloudflare Workers, use Workers Static Assets)
- At 0.x, so the API may change between minor versions

## Install

```sh
npm install @imatomix/mixer @imatomix/mix-static
```

## Usage

Serve files under `./public` from `http://localhost:3000/`:

```ts
import { Mixer } from '@imatomix/mixer'
import { serve } from '@imatomix/mixer/node'
import { serveStatic } from '@imatomix/mix-static'

const app = new Mixer()

app.mix(serveStatic('./public'))

await serve(app, { port: 3000 })
```

Serve files under `./public/images` from `http://localhost:3000/imgs/`:

```ts
app.mix(serveStatic('./public/images', { prefix: '/imgs' }))
```

When a file is not found, it does nothing and hands over to the next component (ending up as mixer's 404).
Files are looked up by mixer's `ctx.path`, so with `basePath` the public directory maps to the paths below it. The directory redirect keeps `basePath` in `Location`.

## Serving a single file (favicon and the like)

`serveFile(filePath, { maxAge })` is a Component that always returns the given file. It does not check the path, so combine it with [mix-router](https://github.com/imatomix/mixer/tree/main/packages/mix-router) or similar.

```ts
import { get } from '@imatomix/mix-router'
import { serveFile } from '@imatomix/mix-static'

app.mix(
  get('/favicon.ico', serveFile('./assets/favicon.ico', { maxAge: 86400 })),
  get('/robots.txt', serveFile('./assets/robots.txt')),
)
```

- Methods other than GET and HEAD hand over to the next component
- The file's existence and type (a regular file) are checked at definition. If it disappears at runtime, the request hands over to the next component
- Response headers and 304 handling are the same as `serveStatic`

If `favicon.ico` is in the public directory, `serveStatic` alone serves it (the old mix-favicon package has been retired).

## Options

| Option | Default | Description |
| --- | --- | --- |
| `root` (first argument) | required | The directory to serve. Throws at definition if it does not exist or is not a directory |
| `prefix` | `'/'` | Only handle requests under this path. Compared segment by segment (`/imgs` does not match `/imgsecret`) |
| `index` | `'index.html'` | File name returned for directory requests. `false` disables it |
| `maxAge` | `0` | Seconds for `Cache-Control: public, max-age=N` |
| `dotfiles` | `false` | Serve files and directories whose names start with a dot, such as `.env` or `.git/` |

## Responses

- `Content-Type`: derived from the extension (common types are built in; unknown ones are `application/octet-stream`)
- `Content-Length`, `ETag` (weak), `Last-Modified`, `Cache-Control`
- `304` when `If-None-Match` / `If-Modified-Since` match (`If-None-Match` takes precedence)
- `HEAD` returns only headers, without reading the file
- Range requests (such as seeking in a video) get `206` with only the requested bytes, or `416` when the range starts past the end. One range per request is served; several ranges, or a malformed `Range`, get the whole file. With `If-Range`, the whole file is sent, because the `ETag` is weak
- The body is streamed, and the file is closed when the response finishes or the client goes away
- `X-Content-Type-Options: nosniff` is added by mixer to every response
- A directory without a trailing `/` is redirected with `301` to the path with `/` (so that relative links in HTML resolve correctly)

## Safety

The following requests are not served (they hand over to the next component):

- `..` or `.` segments, and segments that become `/`, `\`, or NUL after decoding (such as `/..%2F..%2Fetc/passwd`)
- Paths with an empty segment in the middle (`//admin/x`), so that the interpretation does not disagree with other layers that authorize by a prefix of the raw path
- Dotfiles and dot directories (with `dotfiles: false`)
- Symbolic links whose target is outside the public directory, or is a dotfile

Malformed percent-encoding results in `400 Bad Request`.

**Keep the public directory somewhere untrusted users cannot write to.** Replacing a symbolic link between the checks and opening the file is prevented for the last path component with `O_NOFOLLOW`, but replacing a directory in the middle of the path cannot be prevented.

