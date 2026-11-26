import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, errorMessage } from './api.ts'

function answer(response: Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api', () => {
  it('turns a JSON error into an ApiError with its status, message, and request ID', async () => {
    answer(
      Response.json(
        { error: 'Something went wrong', requestId: 'req-1' },
        { status: 500 },
      ),
    )
    const error = await api.todos().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 500,
      message: 'Something went wrong',
      requestId: 'req-1',
    })
  })

  it('keeps the status and request ID when an error is not JSON, such as a proxy page', async () => {
    answer(
      new Response('<h1>Bad Gateway</h1>', {
        status: 502,
        headers: { 'content-type': 'text/html', 'x-request-id': 'req-2' },
      }),
    )
    const error = await api.todos().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 502, requestId: 'req-2' })
  })
})

describe('errorMessage', () => {
  it('adds the request ID to a server failure, for the user to quote', () => {
    expect(
      errorMessage(new ApiError(500, 'Something went wrong', 'req-1')),
    ).toBe('Something went wrong (ID: req-1)')
  })

  it('shows a refusal as it is', () => {
    expect(
      errorMessage(new ApiError(401, 'Wrong name or password', 'req-1')),
    ).toBe('Wrong name or password')
  })

  it('names a failed connection without details', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(
      'Could not reach the server',
    )
  })
})
