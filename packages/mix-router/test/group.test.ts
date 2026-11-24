import { type Component, Mixer } from '@imatomix/mixer'
import { describe, expect, it } from 'vitest'
import { createRouter, get, group, type Route } from '../src/index.js'
import { call } from './helpers.js'

describe('group', () => {
  it('takes routes from a file as an array, without spreading them', async () => {
    const todoRoutes = [
      get('/', () => 'list'),
      get('/:id', (_ctx, { id }) => `todo ${id}`),
    ]
    const app = new Mixer().mix(group('/todos', todoRoutes), () => 'outer')
    expect(await (await call(app, '/todos')).text()).toBe('list')
    expect(await (await call(app, '/todos/7')).text()).toBe('todo 7')
    expect(await (await call(app, '/other')).text()).toBe('outer')
  })

  it('runs components, routes, and arrays in the order given', async () => {
    const order: string[] = []
    const guard: Component = () => {
      order.push('guard')
    }
    const app = new Mixer().mix(
      group(
        '/admin',
        guard,
        [
          () => {
            order.push('first in array')
          },
          get('/users', () => 'users'),
        ],
        get('/stats', () => 'stats'),
      ),
    )
    expect(await (await call(app, '/admin/stats')).text()).toBe('stats')
    expect(order).toEqual(['guard', 'first in array'])
  })

  it('treats an empty array as nothing', async () => {
    const app = new Mixer().mix(group('/empty', []), () => 'outer')
    expect(await (await call(app, '/empty')).text()).toBe('outer')
  })

  it('accepts readonly tuples, and arrays typed with the app state', async () => {
    type AppState = { user: string }
    const typed = createRouter<AppState>()
    const routes = [
      typed.get('/me', (ctx) => ctx.state.user),
    ] as const satisfies readonly Route<AppState>[]
    const app = new Mixer<AppState>().mix(
      (ctx) => {
        ctx.state.user = 'alice'
      },
      typed.group('/api', routes),
    )
    expect(await (await call(app, '/api/me')).text()).toBe('alice')
  })

  it('rejects arrays nested in arrays and routes for another state', () => {
    type AppState = { user: string }
    const typed = createRouter<AppState>()
    const other = createRouter<{ admin: boolean }>()
    // @ts-expect-error only one level of arrays is accepted
    expect(() => group('/x', [[get('/', () => 'nested')]])).not.toThrow()
    const foreign = other.get('/', (ctx) => String(ctx.state.admin))
    // @ts-expect-error a route for another state cannot join this group
    typed.group('/x', foreign)
  })

  it('rejects :param and * in the prefix', () => {
    expect(() => group('/users/:id', [])).toThrow(/group\(\) prefix/)
    expect(() => group('/files/*', [])).toThrow(/group\(\) prefix/)
  })
})
