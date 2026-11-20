import { Mixer } from '@imatomix/mixer'
import { expect, it } from 'vitest'
import { get, namespace } from '../src/index.js'

it('独自の State を持つ Mixer にもルートを mix できる', () => {
  type AppState = { user?: string }
  const app = new Mixer<AppState>()
  app.mix(
    get<'/me', AppState>('/me', (ctx) => ctx.state.user),
    namespace('/api')(get('/ping', () => 'pong')),
  )
  expect(app).toBeDefined()
})
