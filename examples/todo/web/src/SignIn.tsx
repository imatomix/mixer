import { type FormEvent, useState } from 'react'
import { ApiError, api, type User } from './api.ts'

export function SignIn({ onSignIn }: { onSignIn: (user: User) => void }) {
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const { user } = await api.signIn(
        String(form.get('name')),
        String(form.get('password')),
      )
      onSignIn(user)
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong',
      )
    }
  }

  return (
    <form onSubmit={submit}>
      <h2>Sign in</h2>
      {error && <p className="error">{error}</p>}
      <label>
        Name <input name="name" autoComplete="username" required />
      </label>
      <label>
        Password{' '}
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button type="submit">Sign in</button>
    </form>
  )
}
