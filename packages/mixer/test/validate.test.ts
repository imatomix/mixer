import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  HttpError,
  Mixer,
  type StandardSchemaV1,
  ValidationError,
  validateInput,
} from '../src/index.js'
import { call } from './helpers.js'

type Result<O> =
  | StandardSchemaV1.Result<O>
  | Promise<StandardSchemaV1.Result<O>>

/** A schema built by hand, the way schema libraries implement Standard Schema */
function schema<O>(validate: (value: unknown) => Result<O>) {
  return {
    '~standard': { version: 1, vendor: 'test', validate },
  } as StandardSchemaV1<unknown, O>
}

const count = schema((value) =>
  typeof value === 'string' && /^\d+$/.test(value)
    ? { value: Number(value) }
    : { issues: [{ message: `Expected digits, got ${String(value)}` }] },
)

describe('validateInput', () => {
  it('resolves to the schema output, including transforms', async () => {
    const value = await validateInput(count, '42')
    expect(value).toBe(42)
    expectTypeOf(value).toEqualTypeOf<number>()
  })

  it('waits for an async schema', async () => {
    const later = schema(async (value) => ({ value: `checked ${value}` }))
    expect(await validateInput(later, 'a')).toBe('checked a')
  })

  it('throws a 422 ValidationError with the issues when the schema rejects the value', async () => {
    const error = await validateInput(count, 'x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect(error).toBeInstanceOf(HttpError)
    const validation = error as ValidationError
    expect(validation.status).toBe(422)
    expect(validation.expose).toBe(true)
    expect(validation.message).toBe('Invalid request data')
    expect(validation.issues).toEqual([{ message: 'Expected digits, got x' }])
  })

  it('lets an error thrown by the validator through, so it is not mistaken for bad input', async () => {
    const broken = schema(() => {
      throw new Error('bug in the schema')
    })
    const error = await validateInput(broken, 'a').catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(HttpError)
    expect((error as Error).message).toBe('bug in the schema')
  })

  it('rejects something that is not a Standard Schema, or a result that breaks the contract', async () => {
    await expect(validateInput({} as never, 'a')).rejects.toThrow(TypeError)
    const empty = schema(() => ({}) as never)
    await expect(validateInput(empty, 'a')).rejects.toThrow(TypeError)
  })
})

describe('validateInput in an app', () => {
  it('answers 422 with only the fixed message, and does not report it as a failure', async () => {
    const reports: unknown[] = []
    const app = new Mixer().mix(
      (ctx) => {
        ctx.onErrorReport((report) => {
          reports.push(report)
        })
      },
      async (ctx) =>
        `count ${await validateInput(count, ctx.url.searchParams.get('n'))}`,
    )

    const ok = await call(app, '/?n=7')
    expect(await ok.text()).toBe('count 7')

    const bad = await call(app, '/?n=secret')
    expect(bad.status).toBe(422)
    const body = await bad.text()
    expect(JSON.parse(body)).toEqual({ error: 'Invalid request data' })
    expect(body).not.toContain('secret')
    expect(reports).toEqual([])
  })

  it('gives onError the issues, for an app that chooses to show them', async () => {
    const app = new Mixer({
      onError: (error) =>
        error instanceof ValidationError
          ? Response.json(
              { issues: error.issues.map((i) => i.message) },
              { status: 422 },
            )
          : undefined,
    }).mix(async (ctx) => validateInput(count, ctx.url.searchParams.get('n')))

    const res = await call(app, '/?n=x')
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ issues: ['Expected digits, got x'] })
  })

  it('reports a validator that throws as a 500', async () => {
    const reports: unknown[] = []
    const broken = schema(() => {
      throw new Error('bug in the schema')
    })
    const app = new Mixer().mix(
      (ctx) => {
        ctx.onErrorReport((report) => {
          reports.push(report)
        })
      },
      async () => validateInput(broken, 'a'),
    )
    expect((await call(app)).status).toBe(500)
    expect(reports).toHaveLength(1)
  })
})
