import { Mixer } from '@imatomix/mixer'
import { expect, expectTypeOf, it } from 'vitest'
import { createRouter } from '../src/index.js'
import { call } from './helpers.js'

type AppState = { user?: string }

it('createRouter creates routes with a typed State', async () => {
  const { get, namespace } = createRouter<AppState>()
  const app = new Mixer<AppState>()
  app.mix(
    (ctx) => {
      ctx.state.user = 'imatomix'
    },
    namespace('/api')(get('/me', (ctx) => ctx.state.user)),
  )
  expect(app).toBeDefined()

  const served = new Mixer().mix(
    (ctx) => {
      ctx.state.user = 'imatomix'
    },
    namespace('/api')(
      get('/users/:id', (ctx, { id }) => `${ctx.state.user}:${id}`),
    ),
  )
  expect(await (await call(served, `/api/users/1`)).text()).toBe('imatomix:1')
})

type Env = { GREETING: string }

it('createRouter types ctx.env with the second type argument', async () => {
  const { get, namespace } = createRouter<AppState, Env>()
  const app = new Mixer<AppState, Env>().mix(
    namespace('/api')(
      get('/hello/:name', (ctx, { name }) => {
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        return `${ctx.env.GREETING} ${name}`
      }),
    ),
  )
  const res = await app.fetch(new Request('http://localhost/api/hello/mixer'), {
    GREETING: 'hi',
  })
  expect(await res.text()).toBe('hi mixer')
})

it('keeps ctx.env unknown when no Env type is given', () => {
  const { get } = createRouter<AppState>()
  get('/', (ctx) => {
    expectTypeOf(ctx.env).toEqualTypeOf<unknown>()
    return null
  })
})
