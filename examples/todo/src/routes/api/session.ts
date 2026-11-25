import { HttpError, validateInput } from '@imatomix/mixer'
import { z } from 'zod'
import { currentUser } from '../../auth.ts'
import type { Users } from '../../data.ts'
import { del, get, post } from '../../router.ts'

const SignIn = z.strictObject({ name: z.string(), password: z.string() })

/** Signing in and out for a frontend that calls the API; mounted at /api */
export function sessionApiRoutes(users: Users) {
  return [
    post('/session', async (ctx) => {
      const { name, password } = await validateInput(SignIn, await ctx.json())
      const user = await users.authenticate(name, password)
      if (!user) throw new HttpError(401, 'Wrong name or password')
      ctx.state.session.regenerate()
      ctx.state.session.set('userId', user.id)
      ctx.state.session.set('userName', user.name)
      ctx.state.log.info('signed in', { userId: user.id })
      return { user }
    }),

    get('/me', (ctx) => ({ user: currentUser(ctx) })),

    del('/session', (ctx) => {
      ctx.state.session.destroy()
      return null
    }),
  ]
}
