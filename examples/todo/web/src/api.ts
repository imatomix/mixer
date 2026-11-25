export interface User {
  id: string
  name: string
}

export interface Todo {
  id: string
  title: string
  done: boolean
}

/** An answer from the API that is not a success, with the request ID to quote when reporting it */
export class ApiError extends Error {
  readonly status: number
  readonly requestId: string | undefined

  constructor(status: number, message: string, requestId?: string) {
    super(message)
    this.status = status
    this.requestId = requestId
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`/api${path}`, init)
  if (res.status === 204) return undefined as T
  const data = await res.json()
  if (!res.ok) throw new ApiError(res.status, data.error, data.requestId)
  return data as T
}

export const api = {
  me: () => request<{ user: User }>('GET', '/me'),
  signIn: (name: string, password: string) =>
    request<{ user: User }>('POST', '/session', { name, password }),
  signOut: () => request<void>('DELETE', '/session'),
  todos: () => request<Todo[]>('GET', '/todos'),
  addTodo: (title: string) => request<Todo>('POST', '/todos', { title }),
  setDone: (id: string, done: boolean) =>
    request<Todo>('PATCH', `/todos/${id}`, { done }),
  removeTodo: (id: string) => request<void>('DELETE', `/todos/${id}`),
}
