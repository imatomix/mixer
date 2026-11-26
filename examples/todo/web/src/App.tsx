import { Failure } from './Failure.tsx'
import { useSession } from './hooks/useSession.ts'
import { SignIn } from './SignIn.tsx'
import { TodoList } from './TodoList.tsx'

export function App() {
  const session = useSession()

  return (
    <>
      <header>
        <h1>mixer todo</h1>
        {session.user && (
          <p>
            {session.user.name}{' '}
            <button type="button" onClick={session.signOut}>
              Sign out
            </button>
          </p>
        )}
      </header>
      <main>
        <Page session={session} />
      </main>
    </>
  )
}

function Page({ session }: { session: ReturnType<typeof useSession> }) {
  if (session.error) {
    return <Failure message={session.error} onRetry={session.retry} />
  }
  if (session.user === undefined) return <p>Loading…</p>
  if (session.user === null) return <SignIn onSignIn={session.signIn} />
  return <TodoList onSessionEnd={session.ended} />
}
