import { useEffect, useState } from 'react'
import { api, errorMessage, isSignedOut, type User } from '../api.ts'

/** Who is signed in: undefined while asking the API, null when signed out */
export function useSession() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // An answer from an earlier run of this effect must not undo a sign-in made since
    let ignore = false
    setError('')
    api.me().then(
      ({ user }) => {
        if (!ignore) setUser(user)
      },
      (caught) => {
        if (ignore) return
        if (isSignedOut(caught)) setUser(null)
        else setError(errorMessage(caught))
      },
    )
    return () => {
      ignore = true
    }
  }, [attempt])

  return {
    user,
    error,
    retry: () => setAttempt((count) => count + 1),
    /** Throws the API's error, for the sign-in form to show */
    signIn: async (name: string, password: string) => {
      setUser((await api.signIn(name, password)).user)
    },
    signOut: async () => {
      try {
        await api.signOut()
        setUser(null)
      } catch (caught) {
        setError(errorMessage(caught))
      }
    },
    /** For a request that found the session gone */
    ended: () => setUser(null),
  }
}
