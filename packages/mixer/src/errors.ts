export class HttpError extends Error {
  readonly status: number
  readonly expose: boolean

  constructor(status: number, message?: string, options?: ErrorOptions) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new RangeError(
        `HttpError status must be an integer between 400 and 599: ${status}`,
      )
    }
    super(message ?? defaultMessage(status), options)
    this.name = 'HttpError'
    this.status = status
    // 5xx messages may contain internal details, so they are not shown to clients
    this.expose = status < 500
  }
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Bad Request'
    case 404:
      return 'Not Found'
    case 413:
      return 'Payload Too Large'
    default:
      return status < 500 ? 'Client Error' : 'Internal Server Error'
  }
}
