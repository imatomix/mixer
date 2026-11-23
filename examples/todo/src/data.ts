// In-memory data for the example. Everything here is lost on restart and lives in one process: replace both
// with real storage and real authentication before using this anywhere but your own machine

export interface User {
  id: string
  name: string
}

export interface Users {
  /** The user with this name and password, or undefined */
  authenticate(name: string, password: string): Promise<User | undefined>
}

export interface Todo {
  id: string
  userId: string
  title: string
  done: boolean
}

export interface TodoRepository {
  list(userId: string): Promise<Todo[]>
  add(userId: string, title: string): Promise<Todo>
  /** The todo with this ID if it belongs to the user, so one user can never reach another's todos */
  find(userId: string, id: string): Promise<Todo | undefined>
  update(todo: Todo): Promise<void>
  remove(todo: Todo): Promise<void>
}

/** Accounts for trying the example locally. Passwords are kept as plain text, which real authentication never does */
export function demoUsers(
  accounts: readonly (User & { password: string })[],
): Users {
  return {
    async authenticate(name, password) {
      const account = accounts.find(
        (candidate) =>
          candidate.name === name && candidate.password === password,
      )
      return account && { id: account.id, name: account.name }
    },
  }
}

export class MemoryTodos implements TodoRepository {
  readonly #todos = new Map<string, Todo>()

  async list(userId: string): Promise<Todo[]> {
    return [...this.#todos.values()].filter((todo) => todo.userId === userId)
  }

  async add(userId: string, title: string): Promise<Todo> {
    const todo = { id: crypto.randomUUID(), userId, title, done: false }
    this.#todos.set(todo.id, todo)
    return { ...todo }
  }

  async find(userId: string, id: string): Promise<Todo | undefined> {
    const todo = this.#todos.get(id)
    return todo?.userId === userId ? { ...todo } : undefined
  }

  async update(todo: Todo): Promise<void> {
    this.#todos.set(todo.id, { ...todo })
  }

  async remove(todo: Todo): Promise<void> {
    this.#todos.delete(todo.id)
  }
}
