import { type FormEvent, useState } from 'react'
import { errorMessage } from './api.ts'

interface Props {
  onSignIn: (name: string, password: string) => Promise<void>
}

export function SignIn({ onSignIn }: Props) {
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    try {
      await onSignIn(String(form.get('name')), String(form.get('password')))
    } catch (caught) {
      setError(errorMessage(caught))
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
