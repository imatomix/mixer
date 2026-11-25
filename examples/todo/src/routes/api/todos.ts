import { HttpError, validateInput } from '@imatomix/mixer'
import { z } from 'zod'
import { currentUser } from '../../auth.ts'
import { TITLE_LENGTH, type Todo, type TodoRepository } from '../../data.ts'
import { del, get, patch, post } from '../../router.ts'

const NewTodo = z.strictObject({
  title: z.string().trim().min(1).max(TITLE_LENGTH),
})
const TodoChange = z.strictObject({ done: z.boolean() })

/** What the frontend sees of a todo */
function view({ id, title, done }: Todo) {
  return { id, title, done }
}

/** The todos of the signed-in user as JSON; mounted at /api/todos */
export function todoApiRoutes(todos: TodoRepository) {
  /** 404 whether the todo does not exist or belongs to someone else, so IDs reveal nothing */
  async function ownTodo(userId: string, id: string): Promise<Todo> {
    const todo = await todos.find(userId, id)
    if (!todo) throw new HttpError(404)
    return todo
  }

  return [
    get('/', async (ctx) => (await todos.list(currentUser(ctx).id)).map(view)),

    post('/', async (ctx) => {
      const user = currentUser(ctx)
      const { title } = await validateInput(NewTodo, await ctx.json())
      const todo = await todos.add(user.id, title)
      ctx.state.log.info('todo added', { todoId: todo.id })
      ctx.status = 201
      return view(todo)
    }),

    patch('/:id', async (ctx, { id }) => {
      const todo = await ownTodo(currentUser(ctx).id, id)
      const { done } = await validateInput(TodoChange, await ctx.json())
      const changed = { ...todo, done }
      await todos.update(changed)
      return view(changed)
    }),

    del('/:id', async (ctx, { id }) => {
      await todos.remove(await ownTodo(currentUser(ctx).id, id))
      return null
    }),
  ]
}
