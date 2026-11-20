type Simplify<T> = { [K in keyof T]: T[K] } & {}

type ExtractParams<Path extends string> =
  Path extends `${string}:${infer Name}/${infer Rest}`
    ? { [K in Name]: string } & ExtractParams<`/${Rest}`>
    : Path extends `${string}:${infer Name}`
      ? { [K in Name]: string }
      : Path extends `${string}*`
        ? { '*': string }
        : Record<never, never>

/** パスパターンから推論したルートパラメータの型。`Params<'/users/:id'>` は `{ id: string }` */
export type Params<Path extends string> = Simplify<ExtractParams<Path>>
