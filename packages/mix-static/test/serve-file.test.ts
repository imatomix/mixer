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

/** ルーターの代わりに、パスが一致したときだけ実行する */
const at =
  (path: string, component: (ctx: Context) => unknown) => (ctx: Context) =>
    ctx.url.pathname === path ? component(ctx) : undefined

describe('serveFile', () => {
  it('指定したファイルを適切なヘッダ付きで返す', async () => {
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

  it('HEAD にはヘッダだけを返し、条件付きリクエストには 304 を返す', async () => {
    const url = await serve(serveFile(favicon))
    const head = await fetch(url, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const etag = head.headers.get('etag') ?? ''
    expect(
      (await fetch(url, { headers: { 'if-none-match': etag } })).status,
    ).toBe(304)
  })

  it('GET と HEAD 以外は次のコンポーネントへ進む', async () => {
    const url = await serve(serveFile(favicon), next)
    expect(await (await fetch(url, { method: 'POST' })).text()).toBe(
      'next component',
    )
  })

  it('実行中にファイルが消えたら次のコンポーネントへ進む', async () => {
    const temporary = join(dir, 'temporary.txt')
    writeFileSync(temporary, 'x')
    const url = await serve(serveFile(temporary), next)
    rmSync(temporary)
    expect(await (await fetch(url)).text()).toBe('next component')
  })

  it('存在しないファイルやディレクトリを指定すると定義時にエラーになる', () => {
    expect(() => serveFile(join(dir, 'missing.ico'))).toThrow()
    expect(() => serveFile(join(dir, 'folder'))).toThrow()
  })

  it.each([-1, 1.5])('maxAge に不正な値（%s）は指定できない', (maxAge) => {
    expect(() => serveFile(favicon, { maxAge })).toThrow()
  })
})
