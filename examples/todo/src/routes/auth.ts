import type { Users } from '../data.ts'
import { htmlResponse } from '../html.ts'
import { field, seeOther } from '../http.ts'
import { loginPage } from '../pages.ts'
import { get, post } from '../router.ts'

export function authRoutes(users: Users) {
  return [
    get('/login', () => htmlResponse(loginPage())),

    post('/login', async (ctx) => {
      const form = await ctx.form()
      const user = await users.authenticate(
        field(form, 'name'),
        field(form, 'password'),
      )
      if (!user) {
        return htmlResponse(loginPage('Wrong name or password'), 401)
      }
      ctx.state.session.regenerate()
      ctx.state.session.set('userId', user.id)
      ctx.state.session.set('userName', user.name)
      ctx.state.log.info('signed in', { userId: user.id })
      return seeOther('/')
    }),

    post('/logout', (ctx) => {
      ctx.state.session.destroy()
      return seeOther('/login')
    }),
  ]
}
