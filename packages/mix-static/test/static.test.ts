import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mixer } from '@imatomix/mixer'
import { beforeAll, describe, expect, it } from 'vitest'
import { serveStatic } from '../src/index.js'
import { app, call, raw } from './helpers.js'

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
  writeFileSync(join(root, 'digits.txt'), '0123456789')
  writeFileSync(join(root, 'style.css'), 'body{}')
  writeFileSync(join(root, 'data.unknownext'), 'x')
  writeFileSync(join(root, '日本語 ファイル.txt'), 'にほんご')
  writeFileSync(join(root, '.env'), 'SECRET=1')
  writeFileSync(join(root, '..dotdot.txt'), 'two dots')
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

describe('serving', () => {
  it('returns files with the right headers', async () => {
    const target = app(serveStatic(root))
    const res = await call(target, `/hello.txt`)
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
    const target = app(serveStatic(root))
    expect((await call(target, `/style.css`)).headers.get('content-type')).toBe(
      'text/css; charset=utf-8',
    )
    expect(
      (await call(target, `/data.unknownext`)).headers.get('content-type'),
    ).toBe('application/octet-stream')
  })

  it('serves file names with non-ASCII characters and spaces', async () => {
    const target = app(serveStatic(root))
    const res = await call(
      target,
      `/${encodeURIComponent('日本語 ファイル.txt')}`,
    )
    expect(await res.text()).toBe('にほんご')
  })

  it('moves on to the next component when the file does not exist', async () => {
    const target = app(serveStatic(root), next)
    expect(await (await call(target, `/missing.txt`)).text()).toBe(
      'next component',
    )
  })

  it('moves on to the next component for methods other than GET and HEAD', async () => {
    const target = app(serveStatic(root), next)
    const res = await call(target, `/hello.txt`, { method: 'POST' })
    expect(await res.text()).toBe('next component')
  })

  it('returns only headers for HEAD', async () => {
    const target = app(serveStatic(root))
    const res = await call(target, `/hello.txt`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('5')
    expect(await res.text()).toBe('')
  })

  it('sets Cache-Control from maxAge', async () => {
    const target = app(serveStatic(root, { maxAge: 3600 }))
    expect(
      (await call(target, `/hello.txt`)).headers.get('cache-control'),
    ).toBe('public, max-age=3600')
  })

  it.each(['//hello.txt', '/sub//index.html'])(
    'does not serve a path with an empty segment in the middle (%s)',
    async (path) => {
      const target = app(serveStatic(root), next)
      expect((await raw(target, path)).body).toBe('next component')
    },
  )
})

describe('directories', () => {
  it('returns index.html', async () => {
    const target = app(serveStatic(root))
    expect(await (await call(target, `/`)).text()).toBe('<h1>root</h1>')
    expect(await (await call(target, `/sub/`)).text()).toBe('<h1>sub</h1>')
  })

  it('redirects with 301 to the path with a trailing slash and keeps the query', async () => {
    const target = app(serveStatic(root))
    const res = await call(target, `/sub?x=1`, { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/sub/?x=1')
  })

  it('does not redirect to a protocol-relative URL for paths starting with //', async () => {
    const target = app(serveStatic(root), next)
    const res = await raw(target, '//evil.example')
    expect(res.headers.location).toBeUndefined()
    expect(res.body).toBe('next component')
  })

  it('moves on to the next component for a directory without an index', async () => {
    const target = app(serveStatic(root), next)
    expect(await (await call(target, `/noindex/`)).text()).toBe(
      'next component',
    )
    expect(await (await call(target, `/noindex`)).text()).toBe('next component')
  })

  it('does not serve directories with index: false', async () => {
    const target = app(serveStatic(root, { index: false }), next)
    expect(await (await call(target, `/`)).text()).toBe('next component')
  })
})

describe('basePath', () => {
  const mounted = () => new Mixer({ basePath: '/api' }).mix(serveStatic(root))

  it('serves files by the path below basePath', async () => {
    expect(await (await call(mounted(), '/api/hello.txt')).text()).toBe('hello')
    expect((await call(mounted(), '/hello.txt')).status).toBe(404)
  })

  it('keeps basePath in the directory redirect', async () => {
    const res = await call(mounted(), '/api/sub?x=1', { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/api/sub/?x=1')
  })

  it('redirects basePath itself to the path with a trailing slash, so relative links stay inside it', async () => {
    const res = await call(mounted(), '/api?x=1', { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/api/?x=1')
    expect(await (await call(mounted(), '/api/')).text()).toBe('<h1>root</h1>')
  })
})

describe('prefix', () => {
  it('serves only paths under prefix', async () => {
    const target = app(serveStatic(root, { prefix: '/assets' }), next)
    expect(await (await call(target, `/assets/hello.txt`)).text()).toBe('hello')
    expect(await (await call(target, `/hello.txt`)).text()).toBe(
      'next component',
    )
  })

  it('compares segment by segment (/assets does not match /assetsx)', async () => {
    const target = app(serveStatic(root, { prefix: '/assets' }), next)
    expect(await (await call(target, `/assetsx/hello.txt`)).text()).toBe(
      'next component',
    )
  })

  it('redirects the prefix itself to the path with a trailing slash', async () => {
    const target = app(serveStatic(root, { prefix: '/assets' }))
    const res = await call(target, `/assets`, { redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/assets/')
  })
})

describe('conditional requests', () => {
  it('returns 304 when If-None-Match matches', async () => {
    const target = app(serveStatic(root))
    const etag = (await call(target, `/hello.txt`)).headers.get('etag') ?? ''
    const res = await call(target, `/hello.txt`, {
      headers: { 'if-none-match': etag },
    })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
    expect(res.headers.get('etag')).toBe(etag)
  })

  it('returns 304 when If-Modified-Since is at or after the modification time', async () => {
    const target = app(serveStatic(root))
    const res = await call(target, `/hello.txt`, {
      headers: { 'if-modified-since': 'Thu, 01 Jan 2026 00:00:00 GMT' },
    })
    expect(res.status).toBe(304)
  })

  it('gives If-None-Match precedence over If-Modified-Since', async () => {
    const target = app(serveStatic(root))
    const res = await call(target, `/hello.txt`, {
      headers: {
        'if-none-match': 'W/"other"',
        'if-modified-since': 'Fri, 01 Jan 2100 00:00:00 GMT',
      },
    })
    expect(res.status).toBe(200)
  })
})

describe('range requests', () => {
  const ranged = (range: string, headers: Record<string, string> = {}) =>
    call(app(serveStatic(root)), '/digits.txt', {
      headers: { range, ...headers },
    })

  it('advertises Accept-Ranges: bytes', async () => {
    const res = await call(app(serveStatic(root)), '/digits.txt')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
  })

  it.each([
    ['bytes=2-4', '234', 'bytes 2-4/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=5-100', '56789', 'bytes 5-9/10'],
    ['bytes=-100', '0123456789', 'bytes 0-9/10'],
    [' bytes=0-0 ', '0', 'bytes 0-0/10'],
  ])(
    'answers %s with 206 and only that part',
    async (range, body, contentRange) => {
      const res = await ranged(range)
      expect(res.status).toBe(206)
      expect(await res.text()).toBe(body)
      expect(res.headers.get('content-range')).toBe(contentRange)
      expect(res.headers.get('content-length')).toBe(String(body.length))
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    },
  )

  it.each(['bytes=10-', 'bytes=10-20', 'bytes=-0'])(
    'answers %s with 416 and the size',
    async (range) => {
      const res = await ranged(range)
      expect(res.status).toBe(416)
      expect(res.headers.get('content-range')).toBe('bytes */10')
      expect(await res.json()).toEqual({ error: 'Range Not Satisfiable' })
    },
  )

  it('lets onError shape the 416 response', async () => {
    const target = new Mixer({
      onError: (_error, ctx) => ({ custom: ctx.status }),
    }).mix(serveStatic(root))
    const res = await call(target, '/digits.txt', {
      headers: { range: 'bytes=10-' },
    })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
    expect(await res.json()).toEqual({ custom: 416 })
  })

  it.each([
    'bytes=0-1,3-4',
    'bytes=4-2',
    'bytes=-',
    'bytes=abc',
    'items=0-1',
    `bytes=0-${'9'.repeat(30)}x`,
  ])('ignores %s and sends the whole file', async (range) => {
    const res = await ranged(range)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('0123456789')
  })

  it('sends the whole file when If-Range is present, as the ETag is weak', async () => {
    const etag =
      (await call(app(serveStatic(root)), '/digits.txt')).headers.get('etag') ??
      ''
    const res = await ranged('bytes=2-4', { 'if-range': etag })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('0123456789')
  })

  it('answers 304 before looking at Range', async () => {
    const etag =
      (await call(app(serveStatic(root)), '/digits.txt')).headers.get('etag') ??
      ''
    const res = await ranged('bytes=2-4', { 'if-none-match': etag })
    expect(res.status).toBe(304)
  })

  it('ignores Range for HEAD', async () => {
    const res = await call(app(serveStatic(root)), '/digits.txt', {
      method: 'HEAD',
      headers: { range: 'bytes=2-4' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('10')
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
    const target = app(serveStatic(root), next)
    const res = await raw(target, path)
    expect(res.body).not.toContain('OUTSIDE')
    expect(res.body).not.toContain('SECRET')
  })

  it('does not serve paths that contain NUL', async () => {
    const target = app(serveStatic(root), next)
    expect((await raw(target, '/hello.txt%00.png')).body).toBe('next component')
  })

  it('returns 400 for malformed percent-encoding', async () => {
    const target = app(serveStatic(root))
    expect((await raw(target, '/%E3%81')).status).toBe(400)
  })

  it('does not serve dotfiles and dot directories by default', async () => {
    const target = app(serveStatic(root), next)
    expect(await (await call(target, `/.env`)).text()).toBe('next component')
    expect(await (await call(target, `/.well-known/x.txt`)).text()).toBe(
      'next component',
    )
  })

  it('serves dotfiles with dotfiles: true', async () => {
    const target = app(serveStatic(root, { dotfiles: true }))
    expect(await (await call(target, `/.well-known/x.txt`)).text()).toBe(
      'dot dir',
    )
  })

  it('serves a file whose name starts with two dots with dotfiles: true', async () => {
    const target = app(serveStatic(root, { dotfiles: true }))
    expect(await (await call(target, '/..dotdot.txt')).text()).toBe('two dots')
  })

  it('does not serve symbolic links that point outside the public directory', async () => {
    const target = app(serveStatic(root), next)
    expect(await (await call(target, `/link-out.txt`)).text()).toBe(
      'next component',
    )
  })

  it('does not serve symbolic links that point to dotfiles', async () => {
    const target = app(serveStatic(root), next)
    expect(await (await call(target, `/alias-to-dotfile.txt`)).text()).toBe(
      'next component',
    )
    expect(await (await call(target, `/alias-to-dotdir/x.txt`)).text()).toBe(
      'next component',
    )
  })

  it('serves symbolic links that point inside the public directory', async () => {
    const target = app(serveStatic(root))
    expect(await (await call(target, `/link-in.txt`)).text()).toBe('hello')
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
