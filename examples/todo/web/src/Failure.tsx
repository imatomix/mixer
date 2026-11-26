interface Props {
  message: string
  onRetry: () => void
}

export function Failure({ message, onRetry }: Props) {
  return (
    <div>
      <p className="error">{message}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}
