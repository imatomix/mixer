export interface User {
  id: string
  name: string
}

export interface Todo {
  id: string
  title: string
  done: boolean
}

/** An answer from the API that is not a success */
export class ApiError extends Error {
  readonly status: number
  /** The ID the server logged the request under, for the user to quote when reporting a failure */
  readonly requestId: string | undefined

  constructor(status: number, message: string, requestId?: string) {
    super(message)
    this.status = status
    this.requestId = requestId
  }
}

/** The text to show for an error from `api` */
export function errorMessage(error: unknown): string {
  // fetch() throws a TypeError when it gets no answer at all
  if (!(error instanceof ApiError)) return 'Could not reach the server'
  if (error.status >= 500 && error.requestId) {
    return `${error.message} (ID: ${error.requestId})`
  }
  return error.message
}

/** True when the session has ended, so the app should show the sign-in form */
export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
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
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Reads the API's `{ error, requestId }`, or keeps what it can when a proxy answered with a page */
async function toApiError(res: Response): Promise<ApiError> {
  const isJson = res.headers.get('content-type')?.startsWith('application/json')
  const data = isJson ? await res.json().catch(() => undefined) : undefined
  return new ApiError(
    res.status,
    data?.error ?? `The server answered ${res.status}`,
    data?.requestId ?? res.headers.get('x-request-id') ?? undefined,
  )
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
