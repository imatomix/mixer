import type { Context } from '@imatomix/mixer'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  all,
  del,
  get,
  head,
  namespace,
  options,
  type Params,
  patch,
  post,
  put,
  route,
} from '../src/index.js'
import { serve } from './helpers.js'

describe('メソッド', () => {
  it('get はパスとメソッドが一致したときだけ応答する', async () => {
    const url = await serve(get('/hello', () => 'hello'))
    expect(await (await fetch(`${url}/hello`)).text()).toBe('hello')
    expect((await fetch(`${url}/hello`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${url}/other`)).status).toBe(404)
  })

  it('get は HEAD にも応答する', async () => {
    const url = await serve(get('/hello', () => 'hello'))
    const res = await fetch(`${url}/hello`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it.each([
    ['POST', post],
    ['PUT', put],
    ['PATCH', patch],
    ['DELETE', del],
    ['HEAD', head],
    ['OPTIONS', options],
  ] as const)('%s 用の関数はそのメソッドにだけ応答する', async (method, fn) => {
    const url = await serve(fn('/x', () => null))
    expect((await fetch(`${url}/x`, { method })).status).toBe(204)
    expect((await fetch(`${url}/x`)).status).toBe(404)
  })

  it('all はすべてのメソッドに応答する', async () => {
    const url = await serve(all('/x', (ctx) => ctx.method))
    expect(await (await fetch(`${url}/x`, { method: 'PUT' })).text()).toBe(
      'PUT',
    )
    expect(await (await fetch(`${url}/x`)).text()).toBe('GET')
  })

  it('route は任意のメソッドを配列でも指定できる', async () => {
    const url = await serve(
      route(['propfind', 'MKCOL'], '/dav', (ctx) => ctx.method),
    )
    expect(
      await (await fetch(`${url}/dav`, { method: 'PROPFIND' })).text(),
    ).toBe('PROPFIND')
    expect(await (await fetch(`${url}/dav`, { method: 'MKCOL' })).text()).toBe(
      'MKCOL',
    )
    expect((await fetch(`${url}/dav`)).status).toBe(404)
  })
})

describe('パスパターン', () => {
  it(':name をパラメータとして第2引数に渡す', async () => {
    const url = await serve(
      get('/users/:userId/posts/:postId', (_ctx, params) => params),
    )
    expect(await (await fetch(`${url}/users/1/posts/abc`)).json()).toEqual({
      userId: '1',
      postId: 'abc',
    })
  })

  it('パラメータを URL デコードする', async () => {
    const url = await serve(get('/mix/:fruit', (_ctx, { fruit }) => fruit))
    expect(
      await (await fetch(`${url}/mix/${encodeURIComponent('りんご')}`)).text(),
    ).toBe('りんご')
  })

  it('日本語を含む固定パスにもマッチする', async () => {
    const url = await serve(get('/ジュース', () => 'ok'))
    expect(await (await fetch(`${url}/ジュース`)).text()).toBe('ok')
  })

  it('末尾のスラッシュの有無を区別しない', async () => {
    const url = await serve(get('/hello', () => 'ok'))
    expect(await (await fetch(`${url}/hello/`)).text()).toBe('ok')
  })

  it('セグメント数が違えばマッチしない', async () => {
    const url = await serve(get('/a/:b', () => 'ok'))
    expect((await fetch(`${url}/a`)).status).toBe(404)
    expect((await fetch(`${url}/a/b/c`)).status).toBe(404)
  })

  it('* は残りのパスすべてにマッチし、params["*"] に入れる', async () => {
    const url = await serve(get('/files/*', (_ctx, params) => params))
    expect(await (await fetch(`${url}/files/a/b/c.txt`)).json()).toEqual({
      '*': 'a/b/c.txt',
    })
    expect(await (await fetch(`${url}/files`)).json()).toEqual({ '*': '' })
  })

  it('/* はすべてのパスにマッチする', async () => {
    const url = await serve(all('/*', () => 'fallback'))
    expect(await (await fetch(`${url}/`)).text()).toBe('fallback')
    expect(await (await fetch(`${url}/a/b`)).text()).toBe('fallback')
  })

  it('* を末尾以外に置くと定義時にエラーになる', () => {
    expect(() => get('/a/*/b', () => null)).toThrow()
  })

  it('クエリは ctx.url.searchParams で読める', async () => {
    const url = await serve(
      get('/search', (ctx) => ctx.url.searchParams.get('q')),
    )
    expect(await (await fetch(`${url}/search?q=mixer`)).text()).toBe('mixer')
  })
})

describe('安全性', () => {
  it('デコード後に / を含むセグメントにはマッチしない', async () => {
    const url = await serve(
      get('/files/:name', (_ctx, { name }) => name),
      get('/raw/*', (_ctx, params) => params['*']),
    )
    expect((await fetch(`${url}/files/..%2F..%2Fetc`)).status).toBe(404)
    expect((await fetch(`${url}/raw/a/..%2Fetc`)).status).toBe(404)
  })

  it('NUL 文字を含むセグメントにはマッチしない', async () => {
    const url = await serve(get('/files/:name', (_ctx, { name }) => name))
    expect((await fetch(`${url}/files/a%00b`)).status).toBe(404)
  })

  it('不正なエンコーディングはマッチしない扱いにする', async () => {
    const url = await serve(get('/files/:name', (_ctx, { name }) => name))
    expect((await fetch(`${url}/files/%E3%81`)).status).toBe(404)
  })

  it('params はプロトタイプを持たない', async () => {
    const url = await serve(
      get('/:name', (_ctx, params) => Object.getPrototypeOf(params) === null),
    )
    expect(await (await fetch(`${url}/x`)).json()).toBe(true)
  })

  it('マッチしなかったルートのパラメータが後続に漏れない', async () => {
    const url = await serve(
      get('/a/:x/b', (_ctx, params) => params),
      get('/a/:y/c', (_ctx, params) => params),
    )
    expect(await (await fetch(`${url}/a/1/c`)).json()).toEqual({ y: '1' })
  })
})

describe('ハンドラの連結', () => {
  it('複数のハンドラを順に実行し、値を返したところで止まる', async () => {
    const calls: string[] = []
    const url = await serve(
      get(
        '/x',
        () => {
          calls.push('a')
        },
        () => {
          calls.push('b')
          return 'done'
        },
        () => {
          calls.push('c')
        },
      ),
    )
    expect(await (await fetch(`${url}/x`)).text()).toBe('done')
    expect(calls).toEqual(['a', 'b'])
  })

  it('ハンドラが値を返さなければ次のコンポーネントへ進む', async () => {
    const url = await serve(
      get('/x', () => {}),
      () => 'next component',
    )
    expect(await (await fetch(`${url}/x`)).text()).toBe('next component')
  })

  it('0 や空文字も応答として扱う', async () => {
    const url = await serve(
      get('/zero', () => 0),
      () => 'next',
    )
    expect(await (await fetch(`${url}/zero`)).json()).toBe(0)
  })

  it('ctx.send で応答したら後続のハンドラを実行しない', async () => {
    let reached = false
    const url = await serve(
      get(
        '/x',
        (ctx) => ctx.send(201, 'sent'),
        () => {
          reached = true
        },
      ),
    )
    const res = await fetch(`${url}/x`)
    expect(res.status).toBe(201)
    expect(reached).toBe(false)
  })

  it('普通の Component もハンドラとして並べられる', async () => {
    const setHeader = (ctx: Context) => {
      ctx.res.setHeader('x-mixed', 'yes')
    }
    const url = await serve(get('/x', setHeader, () => 'ok'))
    expect((await fetch(`${url}/x`)).headers.get('x-mixed')).toBe('yes')
  })
})

describe('namespace', () => {
  it('ルートの先頭にパスを付ける', async () => {
    const api = namespace('/api/v1')
    const url = await serve(api(get('/users/:id', (_ctx, { id }) => id)))
    expect(await (await fetch(`${url}/api/v1/users/42`)).text()).toBe('42')
    expect((await fetch(`${url}/users/42`)).status).toBe(404)
  })

  it('入れ子にするとパスを連結する', async () => {
    const url = await serve(
      namespace('/api')(namespace('/v2')(get('/', () => 'v2 root'))),
    )
    expect(await (await fetch(`${url}/api/v2`)).text()).toBe('v2 root')
  })

  it('どのルートも応答しなければ次のコンポーネントへ進む', async () => {
    const url = await serve(
      namespace('/api')(get('/a', () => 'a')),
      () => 'next',
    )
    expect(await (await fetch(`${url}/api/b`)).text()).toBe('next')
  })

  it('namespace のパスにパラメータやワイルドカードは使えない', () => {
    expect(() => namespace('/users/:id')).toThrow()
    expect(() => namespace('/files/*')).toThrow()
  })
})

describe('型', () => {
  it('パスからパラメータの型を推論する', () => {
    expectTypeOf<Params<'/users/:id/posts/:postId'>>().toEqualTypeOf<{
      id: string
      postId: string
    }>()
    expectTypeOf<Params<'/files/:dir/*'>>().toEqualTypeOf<{
      dir: string
      '*': string
    }>()
    expectTypeOf<Params<'/static'>>().toEqualTypeOf<Record<never, never>>()
  })

  it('存在しないパラメータを参照すると型エラーになる', () => {
    get('/users/:id', (_ctx, params) => {
      // @ts-expect-error
      return params.name
    })
  })
})
