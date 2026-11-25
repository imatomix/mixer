import { type FormEvent, useEffect, useState } from 'react'
import { ApiError, api, type Todo, type User } from './api.ts'

const TITLE_LENGTH = 200

interface Props {
  user: User
  onSignOut: () => void
}

export function TodoList({ user, onSignOut }: Props) {
  const [todos, setTodos] = useState<Todo[]>([])
  // Changes wait for the first list, so a late list never overwrites them
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  /** Runs a call to the API and shows its error, with the request ID to quote */
  async function attempt(call: () => Promise<void>) {
    try {
      setError('')
      await call()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401)
        return onSignOut()
      setError(
        caught instanceof ApiError
          ? `${caught.message}${caught.requestId ? ` (ID: ${caught.requestId})` : ''}`
          : 'Something went wrong',
      )
    }
  }

  useEffect(() => {
    void attempt(async () => {
      setTodos(await api.todos())
      setLoaded(true)
    })
  }, [])

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const title = String(new FormData(form).get('title'))
    await attempt(async () => {
      const todo = await api.addTodo(title)
      setTodos((list) => [...list, todo])
      form.reset()
    })
  }

  const toggle = (todo: Todo) =>
    attempt(async () => {
      const changed = await api.setDone(todo.id, !todo.done)
      setTodos((list) =>
        list.map((item) => (item.id === todo.id ? changed : item)),
      )
    })

  const remove = (todo: Todo) =>
    attempt(async () => {
      await api.removeTodo(todo.id)
      setTodos((list) => list.filter((item) => item.id !== todo.id))
    })

  const signOut = () =>
    attempt(async () => {
      await api.signOut()
      onSignOut()
    })

  return (
    <section>
      <p className="user">
        {user.name}{' '}
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </p>
      <h2>Todos</h2>
      {error && <p className="error">{error}</p>}
      {!loaded && !error && <p>Loading…</p>}
      <form onSubmit={add} hidden={!loaded}>
        <input
          name="title"
          maxLength={TITLE_LENGTH}
          required
          aria-label="New todo"
        />
        <button type="submit">Add</button>
      </form>
      <ul hidden={!loaded}>
        {todos.map((todo) => (
          <li key={todo.id} className={todo.done ? 'done' : undefined}>
            <button type="button" onClick={() => toggle(todo)}>
              {todo.done ? 'Undo' : 'Done'}
            </button>
            <span>{todo.title}</span>
            <button type="button" onClick={() => remove(todo)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
