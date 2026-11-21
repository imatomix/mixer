import { Mixer } from '@imatomix/mixer'
import { expect, it } from 'vitest'
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
