import type { Todo } from './api.ts'

interface Props {
  todo: Todo
  onToggle: (todo: Todo) => void
  onRemove: (todo: Todo) => void
}

export function TodoItem({ todo, onToggle, onRemove }: Props) {
  return (
    <li className={todo.done ? 'done' : undefined}>
      <button type="button" onClick={() => onToggle(todo)}>
        {todo.done ? 'Undo' : 'Done'}
      </button>
      <span>{todo.title}</span>
      <button type="button" onClick={() => onRemove(todo)}>
        Delete
      </button>
    </li>
  )
}
