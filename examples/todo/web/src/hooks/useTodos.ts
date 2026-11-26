import { useEffect, useState } from 'react'
import { api, errorMessage, isSignedOut, type Todo } from '../api.ts'

/** The signed-in user's todos: undefined until the first list arrives */
export function useTodos(onSessionEnd: () => void) {
  const [todos, setTodos] = useState<Todo[] | undefined>(undefined)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  function fail(caught: unknown) {
    if (isSignedOut(caught)) onSessionEnd()
    else setError(errorMessage(caught))
  }

  useEffect(() => {
    // An answer from an earlier run of this effect must not change the list
    let ignore = false
    setError('')
    api.todos().then(
      (list) => {
        if (!ignore) setTodos(list)
      },
      (caught) => {
        if (!ignore) fail(caught)
      },
    )
    return () => {
      ignore = true
    }
  }, [attempt])

  /** Runs a change and reports whether it worked */
  async function change(call: () => Promise<void>): Promise<boolean> {
    setError('')
    try {
      await call()
      return true
    } catch (caught) {
      fail(caught)
      return false
    }
  }

  return {
    todos,
    error,
    retry: () => setAttempt((count) => count + 1),
    add: (title: string) =>
      change(async () => {
        const todo = await api.addTodo(title)
        setTodos((list) => list && [...list, todo])
      }),
    toggle: (todo: Todo) =>
      change(async () => {
        const changed = await api.setDone(todo.id, !todo.done)
        setTodos((list) =>
          list?.map((item) => (item.id === todo.id ? changed : item)),
        )
      }),
    remove: (todo: Todo) =>
      change(async () => {
        await api.removeTodo(todo.id)
        setTodos((list) => list?.filter((item) => item.id !== todo.id))
      }),
  }
}
