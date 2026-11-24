import { type Component, HttpError } from '@imatomix/mixer'
import { seeOther } from './http.ts'
import type { AppState } from './router.ts'

export interface SignedInUser {
  id: string
  name: string
}

/** Sends visitors who are not signed in to the login page; put it before the routes that need a user */
export const requireSignIn: Component<AppState> = (ctx) =>
  signedInUser(ctx) ? undefined : seeOther('/login')

/** The signed-in user, for routes after requireSignIn */
export function currentUser(ctx: { state: AppState }): SignedInUser {
  const user = signedInUser(ctx)
  if (!user) throw new HttpError(401)
  return user
}

function signedInUser(ctx: { state: AppState }): SignedInUser | undefined {
  const id = ctx.state.session.get('userId')
  const name = ctx.state.session.get('userName')
  return id && name ? { id, name } : undefined
}
