import { useEffect, useState } from 'react'
import { ApiError, api, type User } from './api.ts'
import { SignIn } from './SignIn.tsx'
import { TodoList } from './TodoList.tsx'

/** Shows the todos when signed in, and the sign-in form otherwise */
export function App() {
  // undefined while asking the API who is signed in
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    // An answer from an earlier run of this effect must not undo a sign-in made since
    let ignore = false
    api.me().then(
      ({ user }) => {
        if (!ignore) setUser(user)
      },
      (caught) => {
        if (ignore) return
        if (caught instanceof ApiError && caught.status === 401) setUser(null)
        else setError('Could not reach the server')
      },
    )
    return () => {
      ignore = true
    }
  }, [])

  return (
    <>
      <header>
        <h1>mixer todo</h1>
      </header>
      <main>
        {error && <p className="error">{error}</p>}
        {user === undefined ? null : user === null ? (
          <SignIn onSignIn={setUser} />
        ) : (
          <TodoList user={user} onSignOut={() => setUser(null)} />
        )}
      </main>
    </>
  )
}
