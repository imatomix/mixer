import { HttpError } from '@imatomix/mixer'
import { currentUser } from '../auth.ts'
import { TITLE_LENGTH, type Todo, type TodoRepository } from '../data.ts'
import { htmlResponse } from '../html.ts'
import { field, seeOther } from '../http.ts'
import { listPage } from '../pages.ts'
import { post } from '../router.ts'

/** Mounted at /todos; each one needs a signed-in user */
export function todoRoutes(todos: TodoRepository) {
  /** 404 whether the todo does not exist or belongs to someone else, so IDs reveal nothing */
  async function ownTodo(userId: string, id: string): Promise<Todo> {
    const todo = await todos.find(userId, id)
    if (!todo) throw new HttpError(404)
    return todo
  }

  return [
    post('/', async (ctx) => {
      const user = currentUser(ctx)
      const title = field(await ctx.form(), 'title').trim()
      if (title.length === 0 || title.length > TITLE_LENGTH) {
        const list = listPage(
          user.name,
          await todos.list(user.id),
          `A title is between 1 and ${TITLE_LENGTH} characters`,
        )
        return htmlResponse(list, 422)
      }
      const todo = await todos.add(user.id, title)
      ctx.state.log.info('todo added', { todoId: todo.id })
      return seeOther('/')
    }),

    post('/:id/toggle', async (ctx, { id }) => {
      const todo = await ownTodo(currentUser(ctx).id, id)
      await todos.update({ ...todo, done: !todo.done })
      return seeOther('/')
    }),

    post('/:id/delete', async (ctx, { id }) => {
      await todos.remove(await ownTodo(currentUser(ctx).id, id))
      return seeOther('/')
    }),
  ]
}
