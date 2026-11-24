import { HttpError } from './errors.js'

/**
 * The Standard Schema interface (https://standardschema.dev), implemented by Zod 3.24+, Valibot, ArkType, and
 * others. Copied as the specification suggests, so that mixer has no dependency on it
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
    ) => Result<Output> | Promise<Result<Output>>
    readonly types?: Types<Input, Output> | undefined
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult

  export interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }

  export interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
  }

  export interface PathSegment {
    readonly key: PropertyKey
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
  }

  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['input']

  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['output']
}

/**
 * Thrown by validateInput when the client's data does not match the schema. The response shows only the fixed
 * message, because issue messages can repeat the client's values; an onError that wants to show them reads `issues`
 */
export class ValidationError extends HttpError {
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>

  constructor(issues: ReadonlyArray<StandardSchemaV1.Issue>) {
    super(422, 'Invalid request data')
    this.name = 'ValidationError'
    this.issues = issues
  }
}

/**
 * Checks a value that came from the client (a body, form fields, a query, route parameters) against a schema
 * and resolves to the schema's output. Bad data throws a 422 ValidationError; a validator that throws is a bug,
 * so its error passes through as a 500
 */
export async function validateInput<Schema extends StandardSchemaV1>(
  schema: Schema,
  value: unknown,
): Promise<StandardSchemaV1.InferOutput<Schema>> {
  const standard = schema?.['~standard']
  if (typeof standard?.validate !== 'function') {
    throw new TypeError(
      'mixer: validateInput() needs a Standard Schema, such as a Zod 3.24+ or Valibot schema',
    )
  }
  const result = await standard.validate(value)
  if (result.issues) throw new ValidationError(result.issues)
  if (!('value' in result)) {
    throw new TypeError(
      `mixer: the ${standard.vendor} schema returned neither a value nor issues`,
    )
  }
  return result.value
}
