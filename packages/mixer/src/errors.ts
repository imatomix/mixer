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
        `mixer: HttpError status must be an integer from 400 to 599: ${status}`,
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

// Reason phrases from RFC 9110 and later RFCs, for statuses an HttpError can have
const REASON_PHRASES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  421: 'Misdirected Request',
  422: 'Unprocessable Content',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  507: 'Insufficient Storage',
  511: 'Network Authentication Required',
}

function defaultMessage(status: number): string {
  return (
    REASON_PHRASES[status] ??
    (status < 500 ? 'Client Error' : 'Internal Server Error')
  )
}
