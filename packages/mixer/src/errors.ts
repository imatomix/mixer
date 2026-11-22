export interface HttpErrorOptions extends ErrorOptions {
  /**
   * Headers for the error response, such as `Retry-After` for 429 or `WWW-Authenticate` for 401.
   * Error responses do not keep other headers set before the error, so put them here
   */
  headers?: ConstructorParameters<typeof Headers>[0]
}

export class HttpError extends Error {
  readonly status: number
  readonly expose: boolean
  readonly headers: Headers

  constructor(status: number, message?: string, options?: HttpErrorOptions) {
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
    // Headers rejects values with line breaks, so an error cannot inject other headers
    this.headers = new Headers(options?.headers)
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
