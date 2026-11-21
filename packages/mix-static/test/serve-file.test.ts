import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@imatomix/mixer'
import { beforeAll, describe, expect, it } from 'vitest'
import { serveFile } from '../src/index.js'
import { serve } from './helpers.js'

let dir: string
let favicon: string
const next = () => 'next component'

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mix-static-file-'))
  favicon = join(dir, 'favicon.ico')
  writeFileSync(favicon, Buffer.from([0, 0, 1, 0]))
  mkdirSync(join(dir, 'folder'))
})

/** Stands in for a router: runs the component only when the path matches */
const at =
  (path: string, component: (ctx: Context) => unknown) => (ctx: Context) =>
    ctx.url.pathname === path ? component(ctx) : undefined

describe('serveFile', () => {
  it('returns the given file with the right headers', async () => {
    const url = await serve(
      at('/favicon.ico', serveFile(favicon, { maxAge: 86400 })),
    )
    const res = await fetch(`${url}/favicon.ico`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/x-icon')
    expect(res.headers.get('content-length')).toBe('4')
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0, 0, 1, 0]),
    )
  })

  it('returns only headers for HEAD and 304 for conditional requests', async () => {
    const url = await serve(serveFile(favicon))
    const head = await fetch(url, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const etag = head.headers.get('etag') ?? ''
    expect(
      (await fetch(url, { headers: { 'if-none-match': etag } })).status,
    ).toBe(304)
  })

  it('moves on to the next component for methods other than GET and HEAD', async () => {
    const url = await serve(serveFile(favicon), next)
    expect(await (await fetch(url, { method: 'POST' })).text()).toBe(
      'next component',
    )
  })

  it('moves on to the next component when the file disappears at runtime', async () => {
    const temporary = join(dir, 'temporary.txt')
    writeFileSync(temporary, 'x')
    const url = await serve(serveFile(temporary), next)
    rmSync(temporary)
    expect(await (await fetch(url)).text()).toBe('next component')
  })

  it('throws at definition for a missing file or a directory', () => {
    expect(() => serveFile(join(dir, 'missing.ico'))).toThrow()
    expect(() => serveFile(join(dir, 'folder'))).toThrow()
  })

  it.each([-1, 1.5])('rejects an invalid maxAge (%s)', (maxAge) => {
    expect(() => serveFile(favicon, { maxAge })).toThrow()
  })
})
