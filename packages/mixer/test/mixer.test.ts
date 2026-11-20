import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { HttpError, Mixer } from '../src/index.js'
import { serve } from './helpers.js'

describe('レスポンス', () => {
  it('戻り値の文字列を text/plain で返す', async () => {
    const url = await serve((app) => app.mix(() => 'Hello Mixer'))
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe('Hello Mixer')
  })

  it('戻り値のオブジェクトを JSON で返す', async () => {
    const url = await serve((app) => app.mix(() => ({ ok: true })))
    const res = await fetch(url)
    expect(res.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(await res.json()).toEqual({ ok: true })
  })

  it('0 や false や空文字も値として返す', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        const value = ctx.url.searchParams.get('v')
        if (value === 'zero') return 0
        if (value === 'false') return false
        return ''
      }),
    )
    expect(await (await fetch(`${url}?v=zero`)).json()).toBe(0)
    expect(await (await fetch(`${url}?v=false`)).json()).toBe(false)
    const empty = await fetch(url)
    expect(empty.status).toBe(200)
    expect(await empty.text()).toBe('')
  })

  it('ctx.status で戻り値のステータスを変えられる', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.status = 201
        return { created: true }
      }),
    )
    expect((await fetch(url)).status).toBe(201)
  })

  it('null を返すと 204 になる', async () => {
    const url = await serve((app) => app.mix(() => null))
    const res = await fetch(url)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('Buffer はステータスを保ったまま octet-stream で返す', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => ctx.send(202, Buffer.from([1, 2, 3]))),
    )
    const res = await fetch(url)
    expect(res.status).toBe(202)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    )
  })

  it('Readable ストリームをそのまま流す', async () => {
    const url = await serve((app) => app.mix(() => Readable.from(['a', 'b'])))
    expect(await (await fetch(url)).text()).toBe('ab')
  })

  it('先に設定された Content-Type を上書きしない', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return '<h1>hi</h1>'
      }),
    )
    expect((await fetch(url)).headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    )
  })

  it('マルチバイト文字の Content-Length をバイト数で設定する', async () => {
    const url = await serve((app) => app.mix(() => 'こんにちは'))
    const res = await fetch(url)
    expect(res.headers.get('content-length')).toBe('15')
    expect(await res.text()).toBe('こんにちは')
  })
})

describe('コンポーネントの連結', () => {
  it('mix した順に実行し、値を返したところで止まる', async () => {
    const calls: string[] = []
    const url = await serve((app) =>
      app
        .mix(() => {
          calls.push('a')
        })
        .mix(
          () => {
            calls.push('b')
            return 'done'
          },
          () => {
            calls.push('c')
          },
        ),
    )
    expect(await (await fetch(url)).text()).toBe('done')
    expect(calls).toEqual(['a', 'b'])
  })

  it('ctx.state で後続のコンポーネントに値を渡せる', async () => {
    const url = await serve<{ user?: string }>((app) =>
      app
        .mix((ctx) => {
          ctx.state.user = 'imatomix'
        })
        .mix((ctx) => `hello ${ctx.state.user}`),
    )
    expect(await (await fetch(url)).text()).toBe('hello imatomix')
  })

  it('res を直接使って応答したら後続を実行しない', async () => {
    const after = vi.fn()
    const url = await serve((app) =>
      app
        .mix((ctx) => {
          ctx.res.statusCode = 418
          ctx.res.end('teapot')
        })
        .mix(after),
    )
    const res = await fetch(url)
    expect(res.status).toBe(418)
    expect(await res.text()).toBe('teapot')
    expect(after).not.toHaveBeenCalled()
  })

  it('req と res に独自プロパティを追加しない', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => ({
        reqHasBody: 'body' in ctx.req,
        resHasSend: 'send' in ctx.res,
      })),
    )
    expect(await (await fetch(url)).json()).toEqual({
      reqHasBody: false,
      resHasSend: false,
    })
  })

  it('誰も応答しなければ 404 を返す', async () => {
    const url = await serve((app) => app.mix(() => {}))
    const res = await fetch(url)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not Found' })
  })
})

describe('エラー処理', () => {
  it('HttpError のステータスとメッセージを返す', async () => {
    const url = await serve((app) =>
      app.mix(() => {
        throw new HttpError(403, 'Forbidden')
      }),
    )
    const res = await fetch(url)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('想定外の例外は 500 にして詳細を隠す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const url = await serve((app) =>
      app.mix(() => {
        throw new Error('secret detail')
      }),
    )
    const res = await fetch(url)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('onError でエラーレスポンスを差し替えられる', async () => {
    const url = await serve(
      (app) =>
        app.mix(() => {
          throw new Error('boom')
        }),
      {
        onError: (error, ctx) =>
          ctx.send(503, { message: (error as Error).message }),
      },
    )
    const res = await fetch(url)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ message: 'boom' })
  })
  it('onError が応答しなければ既定のエラーレスポンスを返す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const url = await serve(
      (app) =>
        app.mix(() => {
          throw new Error('boom')
        }),
      { onError: () => {} },
    )
    const res = await fetch(url)
    expect(res.status).toBe(500)
    consoleError.mockRestore()
  })

  it.each([200, 302, 99, 600, 404.5])(
    'HttpError は 4xx・5xx 以外のステータス（%s）を受け付けない',
    (status) => {
      expect(() => new HttpError(status)).toThrow(RangeError)
    },
  )
})

describe('リクエストボディ', () => {
  const echoBody = (app: Mixer) =>
    app.mix(async (ctx) => ({ body: await ctx.body() }))

  it('application/json を JSON として解析する', async () => {
    const url = await serve(echoBody)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ミキサー' }),
    })
    expect(await res.json()).toEqual({ body: { name: 'ミキサー' } })
  })

  it('フォームを解析し、重複キーは配列にする', async () => {
    const url = await serve(echoBody)
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams('a=1&b=2&b=3'),
    })
    expect(await res.json()).toEqual({ body: { a: '1', b: ['2', '3'] } })
  })

  it('text/* は文字列として扱う', async () => {
    const url = await serve(echoBody)
    const res = await fetch(url, { method: 'POST', body: 'plain text' })
    expect(await res.json()).toEqual({ body: 'plain text' })
  })

  it('ボディが空なら undefined になる', async () => {
    const url = await serve((app) =>
      app.mix(async (ctx) => ({
        isUndefined: (await ctx.body()) === undefined,
      })),
    )
    expect(await (await fetch(url)).json()).toEqual({ isUndefined: true })
  })

  it('body() と text() を何度呼んでも同じ内容を返す', async () => {
    const url = await serve((app) =>
      app.mix(async (ctx) => ({
        text: await ctx.text(),
        body: await ctx.body(),
        again: await ctx.text(),
      })),
    )
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"x":1}',
    })
    expect(await res.json()).toEqual({
      text: '{"x":1}',
      body: { x: 1 },
      again: '{"x":1}',
    })
  })

  it('チャンクの境目で分断されたマルチバイト文字を正しく復元する', async () => {
    const url = await serve((app) => app.mix((ctx) => ctx.text()))
    const encoded = Buffer.from('あいう')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.subarray(0, 4))
        controller.enqueue(encoded.subarray(4))
        controller.close()
      },
    })
    const res = await fetch(url, { method: 'POST', body, duplex: 'half' })
    expect(await res.text()).toBe('あいう')
  })

  it('不正な JSON は 400 を返す', async () => {
    const url = await serve(echoBody)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken',
    })
    expect(res.status).toBe(400)
  })

  it('上限を超えたボディは 413 を返す', async () => {
    const url = await serve(echoBody, { bodyLimit: 10 })
    const res = await fetch(url, { method: 'POST', body: 'x'.repeat(100) })
    expect(res.status).toBe(413)
  })

  it('Content-Length がなくても上限を超えたら 413 を返す', async () => {
    const url = await serve(echoBody, { bodyLimit: 10 })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 10; i++) controller.enqueue(Buffer.from('xxxxx'))
        controller.close()
      },
    })
    const res = await fetch(url, { method: 'POST', body, duplex: 'half' })
    expect(res.status).toBe(413)
  })
})

describe('サーバ', () => {
  it('インスタンスごとに独立したサーバを持つ', async () => {
    const urlA = await serve((app) => app.mix(() => 'A'))
    const urlB = await serve((app) => app.mix(() => 'B'))
    expect(urlA).not.toBe(urlB)
    expect(await (await fetch(urlA)).text()).toBe('A')
    expect(await (await fetch(urlB)).text()).toBe('B')
  })

  it('handler を任意の http サーバに渡せる', async () => {
    const { createServer } = await import('node:http')
    const app = new Mixer().mix(() => 'via handler')
    const server = createServer(app.handler)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe(
        'via handler',
      )
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('二重に listen するとエラーになる', async () => {
    const app = new Mixer()
    await app.listen(0, '127.0.0.1')
    try {
      await expect(app.listen(0, '127.0.0.1')).rejects.toThrow(
        'already listening',
      )
    } finally {
      await app.close()
    }
  })
})

describe('onBeforeSend', () => {
  it('応答の直前に登録順で実行し、ヘッダを追加できる', async () => {
    const url = await serve((app) =>
      app
        .mix((ctx) => {
          ctx.onBeforeSend(() => {
            ctx.res.appendHeader('x-order', 'first')
          })
          ctx.onBeforeSend(async () => {
            await Promise.resolve()
            ctx.res.appendHeader('x-order', 'second')
          })
        })
        .mix(() => 'ok'),
    )
    const res = await fetch(url)
    expect(res.headers.get('x-order')).toBe('first, second')
    expect(await res.text()).toBe('ok')
  })

  it('後続のコンポーネントが変えた状態をフックで参照できる', async () => {
    const url = await serve<{ visits?: number }>((app) =>
      app
        .mix((ctx) => {
          ctx.onBeforeSend(() => {
            ctx.res.setHeader('x-visits', String(ctx.state.visits))
          })
        })
        .mix((ctx) => {
          ctx.state.visits = 3
          return 'ok'
        }),
    )
    expect((await fetch(url)).headers.get('x-visits')).toBe('3')
  })

  it('フックで ctx.status を変更できる', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.onBeforeSend(() => {
          ctx.status = 202
        })
        return 'ok'
      }),
    )
    expect((await fetch(url)).status).toBe(202)
  })

  it('エラー応答の前にも実行する', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.onBeforeSend(() => {
          ctx.res.setHeader('x-hooked', 'yes')
        })
        throw new HttpError(400)
      }),
    )
    const res = await fetch(url)
    expect(res.status).toBe(400)
    expect(res.headers.get('x-hooked')).toBe('yes')
  })

  it('フックが失敗したら 500 を返し、フックを再実行しない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.onBeforeSend(() => {
          calls++
          throw new Error('hook failed')
        })
        return 'ok'
      }),
    )
    const res = await fetch(url)
    expect(res.status).toBe(500)
    expect(calls).toBe(1)
    consoleError.mockRestore()
  })
})
