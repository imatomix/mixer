import type { FormEvent } from 'react'
import { Failure } from './Failure.tsx'
import { useTodos } from './hooks/useTodos.ts'
import { TodoItem } from './TodoItem.tsx'

// The API's limit (TITLE_LENGTH in src/data.ts), so the browser stops a longer title before sending it
const TITLE_LENGTH = 200

export function TodoList({ onSessionEnd }: { onSessionEnd: () => void }) {
  const { todos, error, retry, add, toggle, remove } = useTodos(onSessionEnd)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (await add(String(new FormData(form).get('title')))) form.reset()
  }

  if (todos === undefined) {
    return error ? <Failure message={error} onRetry={retry} /> : <p>Loading…</p>
  }

  return (
    <section>
      <h2>Todos</h2>
      {error && <p className="error">{error}</p>}
      <form onSubmit={submit}>
        <input
          name="title"
          maxLength={TITLE_LENGTH}
          required
          aria-label="New todo"
        />
        <button type="submit">Add</button>
      </form>
      <ul>
        {todos.map((todo) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            onToggle={toggle}
            onRemove={remove}
          />
        ))}
      </ul>
    </section>
  )
}
