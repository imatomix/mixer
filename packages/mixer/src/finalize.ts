// BodyInit is a DOM type; derive it from the Response constructor available in every runtime
type Body = ConstructorParameters<typeof Response>[0]

export interface Draft {
  status: number
  headers: Headers
}

// Statuses whose responses cannot have a body
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

/** Turns a value returned by a component into a Response, combined with the response draft */
export function toResponse(value: unknown, draft: Draft): Response {
  if (value instanceof Response) return mergeResponse(value, draft)

  const headers = new Headers(draft.headers)
  if (value === null) {
    const status = draft.status === 200 ? 204 : draft.status
    return new Response(null, { status, headers })
  }

  const { body, type, length } = encode(value)
  if (!headers.has('Content-Type')) headers.set('Content-Type', type)
  if (length !== undefined && !headers.has('Content-Length')) {
    headers.set('Content-Length', String(length))
  }
  const status = draft.status
  return new Response(NULL_BODY_STATUSES.has(status) ? null : body, {
    status,
    headers,
  })
}

function encode(value: unknown): {
  body: Body
  type: string
  length?: number
} {
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value)
    return {
      body: bytes,
      type: 'text/plain; charset=utf-8',
      length: bytes.byteLength,
    }
  }
  if (value instanceof Uint8Array) {
    return {
      body: value,
      type: 'application/octet-stream',
      length: value.byteLength,
    }
  }
  if (value instanceof ArrayBuffer) {
    return {
      body: value,
      type: 'application/octet-stream',
      length: value.byteLength,
    }
  }
  if (value instanceof ReadableStream) {
    return { body: value, type: 'application/octet-stream' }
  }
  if (value instanceof Blob) {
    return {
      body: value,
      type: value.type || 'application/octet-stream',
      length: value.size,
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return {
    body: bytes,
    type: 'application/json; charset=utf-8',
    length: bytes.byteLength,
  }
}

/**
 * The Response's own headers win; draft headers it lacks are added. The Response is rebuilt
 * without reading its body, because headers of some Responses (from fetch() or Response.redirect())
 * cannot be modified
 */
function mergeResponse(response: Response, draft: Draft): Response {
  if (response.type === 'error' || response.status === 0) {
    throw new Error('Cannot respond with Response.error()')
  }
  if (response.bodyUsed || response.body?.locked) {
    throw new Error(
      'Cannot respond with a Response whose body was already read',
    )
  }

  const headers = new Headers(response.headers)
  for (const [name, value] of draft.headers) {
    if (name === 'set-cookie') continue
    if (!headers.has(name)) headers.set(name, value)
  }

  const own = new Set(response.headers.getSetCookie().map(cookieKey))
  for (const cookie of draft.headers.getSetCookie()) {
    if (own.has(cookieKey(cookie))) {
      console.warn(
        `mixer: the returned Response sets the same cookie as the draft, so the Response wins: ${cookie.split('=')[0]}`,
      )
      continue
    }
    headers.append('Set-Cookie', cookie)
  }

  const nullBody = NULL_BODY_STATUSES.has(response.status)
  if (nullBody) void response.body?.cancel().catch(() => {})
  return new Response(nullBody ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** Identifies a cookie by name, Path, and Domain, like browsers do when replacing one */
function cookieKey(setCookie: string): string {
  const [pair = '', ...attributes] = setCookie.split(';')
  const name = pair.split('=')[0]?.trim() ?? ''
  let path = '/'
  let domain = ''
  for (const attribute of attributes) {
    const [key = '', value = ''] = attribute
      .split('=')
      .map((part) => part.trim())
    if (key.toLowerCase() === 'path') path = value
    if (key.toLowerCase() === 'domain') domain = value.toLowerCase()
  }
  return `${name}\n${path}\n${domain}`
}

/**
 * A fresh draft for error responses. Only headers the browser needs to read the error
 * (CORS and Vary) and cookies already set are kept; others such as Location or
 * Cache-Control: public must not leak into an error response
 */
export function errorDraft(from: Headers, status: number): Draft {
  const headers = new Headers()
  for (const [name, value] of from) {
    if (name.startsWith('access-control-') || name === 'vary') {
      headers.set(name, value)
    }
  }
  for (const cookie of from.getSetCookie()) headers.append('Set-Cookie', cookie)
  return { status, headers }
}

/** The last step for every response: safe headers, cookies and caching, and bodies that must be dropped */
export function finalizeResponse(response: Response, method: string): Response {
  const headers = response.headers
  headers.set('X-Content-Type-Options', 'nosniff')

  // A response that sets cookies must never be stored by a shared cache and handed to other users
  if (headers.getSetCookie().length > 0) {
    const cacheControl = headers.get('Cache-Control') ?? ''
    if (!/\b(private|no-store)\b/i.test(cacheControl)) {
      const directives = cacheControl
        .split(',')
        .map((directive) => directive.trim())
        .filter(
          (directive) => directive && directive.toLowerCase() !== 'public',
        )
      headers.set('Cache-Control', ['private', ...directives].join(', '))
    }
  }

  if (NULL_BODY_STATUSES.has(response.status)) {
    headers.delete('Content-Type')
    headers.delete('Content-Length')
  }

  if (method === 'HEAD' && response.body) {
    void response.body.cancel().catch(() => {})
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
  return response
}
