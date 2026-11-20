export class HttpError extends Error {
  readonly status: number
  readonly expose: boolean

  constructor(status: number, message?: string, options?: ErrorOptions) {
    super(message ?? defaultMessage(status), options)
    this.name = 'HttpError'
    this.status = status
    // 5xx のメッセージは内部情報を含みうるのでクライアントには見せない
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
