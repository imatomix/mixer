# 0002. Give routes the signed-in user with a guard and requireUser()

- Status: Accepted
- Date: 2026-11-24

## Context

An app that signs users in checks the session once before the routes that need a user, and those routes then use the user. In the example app (`examples/todo`) the check is a component placed before the protected routes, and each route calls a small helper to get the user, because `ctx.state.user` is typed as possibly missing.

The question was whether a route should see the user as present without that helper, so that a missing or misplaced check is caught by the type checker.

mixer's policy on authentication, decided with the maintainer: let apps use existing authentication libraries, build nothing more than needed, and keep anything we build simple. mixer provides the safe parts around authentication (sessions, session regeneration, secure cookies, CSRF protection, keeping signed-in pages out of caches) and shows where the user goes.

## Options

1. **A.** Keep `user` optional on `ctx.state`. A guard component sets it after checking the session, and each route that needs it calls `requireUser(ctx)`, which throws when it is missing.
2. **B.** Type the protected routes with a second router, `createRouter<AppState & { user: User }>()`, with no new API.
3. **C.** Add a step to mix-router that provides a typed value to the handlers after it, in a route or for a whole namespace.

## What we tried

- **B does not type-check.** A route typed for a state that includes `user` cannot be mixed into an app whose state does not, because the route expects a context the app cannot give. Making it pass needs casts, which hide exactly the mistake we wanted to catch.
- **C was built on a branch** (`provide(key, fn)` and `namespace(prefix, ...steps)`). It worked: routes in a guarded namespace saw `ctx.state.user` as present, a protected route placed outside the guard was a type error, and the example app lost its two user helpers (235 to 230 lines). It cost about 190 lines in mix-router with recursive types, and converting the example exposed a type bug (steps for apps with required state added nothing) that the first tests had missed.
- **A review of C found it incomplete:** only the final handler and the namespace's routes see the added values; a later step or a middle handler cannot use what an earlier step provided, arrays of steps lose their types, and a step can overwrite state set by another module.
- **Input validation does not need C.** Calling a validator inside the handler already gives a typed value, so the only use we found that needed C was the signed-in user (and values derived from it, such as the user's organization), where A costs one line per route.
- **An external library fits A.** A library that takes a Web `Request` and returns a `Response` was mounted on a route and its session read in the guard; sign-up, sign-in, the protected page, the redirect without a session, CSRF protection on its endpoints, and sign-out all worked through `app.fetch`.

## Decision

Use A.

- `ctx.state.user` stays optional. A guard component checks the session, sets `ctx.state.user`, or answers (for example, a redirect to sign in) before the routes that need a user, usually as the first item of a namespace.
- A route that needs the user calls a small `requireUser(ctx)` that returns it or throws, so a missing or misplaced guard fails loudly at run time instead of passing as `undefined`.
- mix-router does not get a typed value step. The mixer README shows this as a general pattern for guards (a guard puts a checked value on `ctx.state`, routes take it with a `requireX(ctx)` helper), with signing users in through a Web-standard authentication library as the example.

## Consequences

- No new router API or type machinery; nothing to maintain beyond documentation.
- A misplaced guard is found when the route runs, not when the code is compiled. Tests that request a protected route without a session catch it.
- Each protected route has one line to get the user.
- If many apps find that line a burden, typed values can be revisited, starting from what this record lists as missing in C.
