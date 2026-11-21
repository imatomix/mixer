import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { serveStatic } from '../src/index.js'
import { serve } from './helpers.js'

let root: string
const next = () => 'next component'

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'mix-static-'))
  root = join(base, 'public')
  // A sibling directory whose name starts like the public directory (slips past a startsWith-only check)
  const sibling = join(base, 'public-secret')
  mkdirSync(root)
  mkdirSync(sibling)
  writeFileSync(join(sibling, 'secret.txt'), 'SECRET')
  writeFileSync(join(base, 'outside.txt'), 'OUTSIDE')

  writeFileSync(join(root, 'index.html'), '<h1>root</h1>')
  writeFileSync(join(root, 'hello.txt'), 'hello')
  writeFileSync(join(root, 'style.css'), 'body{}')
  writeFileSync(join(root, 'data.unknownext'), 'x')
  writeFileSync(join(root, '日本語 ファイル.txt'), 'にほんご')
  writeFileSync(join(root, '.env'), 'SECRET=1')
  mkdirSync(join(root, '.well-known'))
  writeFileSync(join(root, '.well-known', 'x.txt'), 'dot dir')
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'sub', 'index.html'), '<h1>sub</h1>')
  mkdirSync(join(root, 'noindex'))
  writeFileSync(join(root, 'noindex', 'a.txt'), 'a')
  mkdirSync(join(root, 'evil.example'))
  writeFileSync(join(root, 'evil.example', 'index.html'), 'evil dir')
  symlinkSync(join(sibling, 'secret.txt'), join(root, 'link-out.txt'))
  symlinkSync(join(root, 'hello.txt'), join(root, 'link-in.txt'))
  symlinkSync(join(root, '.env'), join(root, 'alias-to-dotfile.txt'))
  symlinkSync(join(root, '.well-known'), join(root, 'alias-to-dotdir'))
  utimesSync(
    join(root, 'hello.txt'),
    new Date('2026-01-01'),
    new Date('2026-01-01'),
  )
})

/** fetch normalizes paths, so attack paths are sent as is */
function raw(
  url: string,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  const { hostname, port } = new URL(url)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname,
        port,
        path,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('serving', () => {
  it('returns files with the right headers', async () => {
    const url = await serve(serveStatic(root))
    const res = await fetch(`${url}/hello.txt`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-length')).toBe('5')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('public, max-age=0')
    expect(res.headers.get('etag')).toMatch(/^W\/".+"$/)
    expect(res.headers.get('last-modified')).toBe(
      'Thu, 01 Jan 2026 00:00:00 GMT',
    )
  })

  it('derives Content-Type from the extension and falls back to octet-stream', async () => {
    const url = await serve(serveStatic(root))
    expect((await fetch(`${url}/style.css`)).headers.get('content-type')).toBe(
      'text/css; charset=utf-8',
    )
    expect(
      (await fetch(`${url}/data.unknownext`)).headers.get('content-type'),
    ).toBe('application/octet-stream')
  })

  it('serves file names with non-ASCII characters and spaces', async () => {
    const url = await serve(serveStatic(root))
    const res = await fetch(
      `${url}/${encodeURIComponent('日本語 ファイル.txt')}`,
    )
    expect(await res.text()).toBe('にほんご')
  })

  it('moves on to the next component when the file does not exist', async () => {
    const url = await serve(serveStatic(root), next)
    expect(await (await fetch(`${url}/missing.txt`)).text()).toBe(
      'next component',
    )
  })

  it('moves on to the next component for methods other than GET and HEAD', async () => {
    const url = await serve(serveStatic(root), next)
    const res = await fetch(`${url}/hello.txt`, { method: 'POST' })
    expect(await res.text()).toBe('next component')
  })

  it('returns only headers for HEAD', async () => {
    const url = await serve(serveStatic(root))
    const res = await fetch(`${url}/hello.txt`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('5')
    expect(await res.text()).toBe('')
  })

  it('sets Cache-Control from maxAge', async () => {
    const url = await serve(serveStatic(root, { maxAge: 3600 }))
    expect((await fetch(`${url}/hello.txt`)).headers.get('cache-control')).toBe(
      'public, max-age=3600',
    )
  })

  it.each(['//hello.txt', '/sub//index.html'])(
    'does not serve a path with an empty segment in the middle (%s)',
    async (path) => {
      const url = await serve(serveStatic(root), next)
      expect((await raw(url, path)).body).toBe('next component')
    },
  )
})

describe('directories', () => {
  it('returns index.html', async () => {
    const url = await serve(serveStatic(root))
    expect(await (await fetch(`${url}/`)).text()).toBe('<h1>root</h1>')
    expect(await (await fetch(`${url}/sub/`)).text()).toBe('<h1>sub</h1>')
  })

  it('redirects with 301 to the path with a trailing slash and keeps the query', async () => {
    const url = await serve(serveStatic(root))
    const res = await fetch(`${url}/sub?x=1`, { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/sub/?x=1')
  })

  it('does not redirect to a protocol-relative URL for paths starting with //', async () => {
    const url = await serve(serveStatic(root), next)
    const res = await raw(url, '//evil.example')
    expect(res.headers.location).toBeUndefined()
    expect(res.body).toBe('next component')
  })

  it('moves on to the next component for a directory without an index', async () => {
    const url = await serve(serveStatic(root), next)
    expect(await (await fetch(`${url}/noindex/`)).text()).toBe('next component')
    expect(await (await fetch(`${url}/noindex`)).text()).toBe('next component')
  })

  it('does not serve directories with index: false', async () => {
    const url = await serve(serveStatic(root, { index: false }), next)
    expect(await (await fetch(`${url}/`)).text()).toBe('next component')
  })
})

describe('prefix', () => {
  it('serves only paths under prefix', async () => {
    const url = await serve(serveStatic(root, { prefix: '/assets' }), next)
    expect(await (await fetch(`${url}/assets/hello.txt`)).text()).toBe('hello')
    expect(await (await fetch(`${url}/hello.txt`)).text()).toBe(
      'next component',
    )
  })

  it('compares segment by segment (/assets does not match /assetsx)', async () => {
    const url = await serve(serveStatic(root, { prefix: '/assets' }), next)
    expect(await (await fetch(`${url}/assetsx/hello.txt`)).text()).toBe(
      'next component',
    )
  })

  it('redirects the prefix itself to the path with a trailing slash', async () => {
    const url = await serve(serveStatic(root, { prefix: '/assets' }))
    const res = await fetch(`${url}/assets`, { redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/assets/')
  })
})

describe('conditional requests', () => {
  it('returns 304 when If-None-Match matches', async () => {
    const url = await serve(serveStatic(root))
    const etag = (await fetch(`${url}/hello.txt`)).headers.get('etag') ?? ''
    const res = await fetch(`${url}/hello.txt`, {
      headers: { 'if-none-match': etag },
    })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
    expect(res.headers.get('etag')).toBe(etag)
  })

  it('returns 304 when If-Modified-Since is at or after the modification time', async () => {
    const url = await serve(serveStatic(root))
    const res = await fetch(`${url}/hello.txt`, {
      headers: { 'if-modified-since': 'Thu, 01 Jan 2026 00:00:00 GMT' },
    })
    expect(res.status).toBe(304)
  })

  it('gives If-None-Match precedence over If-Modified-Since', async () => {
    const url = await serve(serveStatic(root))
    const res = await fetch(`${url}/hello.txt`, {
      headers: {
        'if-none-match': 'W/"other"',
        'if-modified-since': 'Fri, 01 Jan 2100 00:00:00 GMT',
      },
    })
    expect(res.status).toBe(200)
  })
})

describe('safety', () => {
  it.each([
    '/../outside.txt',
    '/../public-secret/secret.txt',
    '/%2e%2e/outside.txt',
    '/..%2Foutside.txt',
    '/..%5Coutside.txt',
    '/sub/..%2F..%2Foutside.txt',
  ])('cannot escape the public directory: %s', async (path) => {
    const url = await serve(serveStatic(root), next)
    const res = await raw(url, path)
    expect(res.body).not.toContain('OUTSIDE')
    expect(res.body).not.toContain('SECRET')
  })

  it('does not serve paths that contain NUL', async () => {
    const url = await serve(serveStatic(root), next)
    expect((await raw(url, '/hello.txt%00.png')).body).toBe('next component')
  })

  it('returns 400 for malformed percent-encoding', async () => {
    const url = await serve(serveStatic(root))
    expect((await raw(url, '/%E3%81')).status).toBe(400)
  })

  it('does not serve dotfiles and dot directories by default', async () => {
    const url = await serve(serveStatic(root), next)
    expect(await (await fetch(`${url}/.env`)).text()).toBe('next component')
    expect(await (await fetch(`${url}/.well-known/x.txt`)).text()).toBe(
      'next component',
    )
  })

  it('serves dotfiles with dotfiles: true', async () => {
    const url = await serve(serveStatic(root, { dotfiles: true }))
    expect(await (await fetch(`${url}/.well-known/x.txt`)).text()).toBe(
      'dot dir',
    )
  })

  it('does not serve symbolic links that point outside the public directory', async () => {
    const url = await serve(serveStatic(root), next)
    expect(await (await fetch(`${url}/link-out.txt`)).text()).toBe(
      'next component',
    )
  })

  it('does not serve symbolic links that point to dotfiles', async () => {
    const url = await serve(serveStatic(root), next)
    expect(await (await fetch(`${url}/alias-to-dotfile.txt`)).text()).toBe(
      'next component',
    )
    expect(await (await fetch(`${url}/alias-to-dotdir/x.txt`)).text()).toBe(
      'next component',
    )
  })

  it('serves symbolic links that point inside the public directory', async () => {
    const url = await serve(serveStatic(root))
    expect(await (await fetch(`${url}/link-in.txt`)).text()).toBe('hello')
  })
})

describe('configuration validation', () => {
  it('throws at definition when root does not exist or is not a directory', () => {
    expect(() => serveStatic(join(root, 'nope'))).toThrow()
    expect(() => serveStatic(join(root, 'hello.txt'))).toThrow()
  })

  it.each(['', '.', '..', 'a/index.html', '..\\x', 'a\0b', '.index.html'])(
    'rejects an invalid index (%j)',
    (index) => {
      expect(() => serveStatic(root, { index })).toThrow()
    },
  )

  it.each([-1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects an invalid maxAge (%s)',
    (maxAge) => {
      expect(() => serveStatic(root, { maxAge })).toThrow()
    },
  )
})
