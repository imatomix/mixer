import { currentUser } from '../auth.ts'
import type { TodoRepository } from '../data.ts'
import { htmlResponse } from '../html.ts'
import { listPage } from '../pages.ts'
import { get } from '../router.ts'

export function homeRoutes(todos: TodoRepository) {
  return [
    get('/', async (ctx) => {
      const user = currentUser(ctx)
      return htmlResponse(listPage(user.name, await todos.list(user.id)))
    }),
  ]
}
