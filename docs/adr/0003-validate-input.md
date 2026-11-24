# 0003. Validate client input with validateInput()

- Status: Accepted
- Date: 2026-11-24

## Context

`ctx.json()` returns `unknown`, so a route has to check the body before using it. Most apps check it with a schema library. The natural code, `Item.parse(await ctx.json())`, throws the library's own error when the client sends bad data, and mixer answers that with `500` and reports it as a server failure. Answering `422` instead takes a few lines in every route (a safe parse, then `throw new HttpError(422)`), and forgetting them is silent.

Schema libraries share a small interface, Standard Schema: a schema has a `~standard` property whose `validate(value)` returns the output or a list of issues, synchronously or as a promise. It is a type-only specification, so supporting it adds no runtime dependency.

## Options

1. **A.** Documentation only: show the safe-parse pattern.
2. **B.** Accept a schema in the body readers: `await ctx.json({ schema })`.
3. **C.** A general function in mixer: `await validateInput(schema, value)`.
4. **D.** A separate package for validation.

## What we tried

- **Zod works without an adapter.** Zod 3.24 and Zod 4 have `~standard`; validation and transforms (`z.coerce.number()` turning `'2'` into `2`) worked, and the output type was inferred from a copy of the Standard Schema types. Zod 3.23 has no `~standard`, so apps on it cannot pass a schema directly.
- **B only covers JSON.** Forms, query strings, and route parameters would each need their own option later, and the readers would grow overloads next to `bodyLimit`.
- **D adds a package, a peer range, and setup** for what is one function, and splits reading from checking for no gain.

## Decision

Use C.

- `validateInput(schema, value)` takes any Standard Schema and resolves to the schema's output type. It works the same for a JSON body, form fields, query strings, or route parameters, and `ctx.json()` stays as it is.
- When the schema reports issues, it throws a `ValidationError`, an `HttpError` with status `422` and the fixed message `Invalid request data`. The default error response shows only that message: issue messages can repeat the client's values and describe the schema, so they reach the client only when the app's `onError` sends them, from `error.issues`.
- A `422` is the client's mistake, so it is not reported as a failure. When the validator itself throws or breaks the contract, that is a bug in the app or the library, so it stays a `500` and is reported, instead of looking like bad input.
- The name says the value comes from the client. With a plain `validate`, apps might check configuration or stored data with it, and a server-side bug would come back as a `422` that is never reported.
- The Standard Schema types are copied into mixer, as the specification suggests, so there is no dependency.

## Consequences

- One line per route, typed, and bad input is `422` by default.
- Malformed JSON stays `400`, a wrong Content-Type `415`, and a body over the limit `413`, all before validation.
- Keys such as `__proto__` pass through `JSON.parse` as plain data, but code after the schema may copy them; the README tells apps to have the schema reject or strip unknown keys.
- Turning `FormData` or `URLSearchParams` into an object is left to the app (`Object.fromEntries` keeps only one value per name); the README shows it.
- Apps on Zod 3.23 or older need to upgrade, or use the safe-parse pattern.
