# mixer documentation

English | [日本語](README.ja.md)

Where to find what, by what you want to do.

## Start

- [Quick start](../packages/mixer/README.md#quick-start): install mixer and answer your first request
- [Recommended stacks](../README.md#recommended-stacks): the modules to combine for a browser app and for a JSON API
- [Example app](../examples/todo): a todo app with sign-in, sessions, CSRF protection, and security headers, running on Node.js, Bun, and Cloudflare Workers

## Examples

- [A JSON API](examples/json-api.md): create, list, and read with input checked by Zod
- [Receiving a webhook](examples/webhook.md): a signed request, checked before anything is trusted

## Run your app

- [Node.js](how-to/runtimes.md#nodejs), [Bun](how-to/runtimes.md#bun), and [Cloudflare Workers](how-to/runtimes.md#cloudflare-workers)
- [Inside another framework](how-to/runtimes.md#inside-frameworks) such as Next.js, Nuxt, SvelteKit, or React Router
- [Behind a proxy](reference/mixer.md#client-ip-address): the client's IP address and `trustedProxies`

## Do common tasks

- Routes, groups of routes, and `405`: [mix-router](../packages/mix-router)
- Test your app without a server: [Testing your app](how-to/testing.md)
- Mount a whole app, mixer or another framework: [mount](../packages/mix-router/README.md#mount)
- Sign users in and check them before routes: [Guarding routes](how-to/auth-and-guards.md)
- Read and validate the request body: [Request body](how-to/request-body.md)
- Send Server-Sent Events: [Server-Sent Events](how-to/streaming-and-background-work.md#server-sent-events)
- Handle slow work and run work after the response: [Slow work](how-to/streaming-and-background-work.md#slow-work), [ctx.waitUntil()](how-to/streaming-and-background-work.md#ctxwaituntil)
- Sessions: [mix-session](../packages/mix-session) · CSRF protection: [mix-csrf](../packages/mix-csrf) · Security headers: [mix-secure-headers](../packages/mix-secure-headers) · CORS: [mix-cors](../packages/mix-cors)
- Static files: [mix-static](../packages/mix-static) · Request logs: [mix-logger](../packages/mix-logger) · Compression: [mix-compress](../packages/mix-compress)

## Look things up

- [Components](../packages/mixer/README.md#components) and [ctx](reference/context.md#ctx)
- [What a component can return](reference/responses.md#what-a-component-can-return) and [Returning a Response](reference/responses.md#returning-a-response)
- [Errors](reference/responses.md#errors) and [Error reports](reference/responses.md#error-reports)
- [Cookies](reference/responses.md#cookies), [Redirects](reference/responses.md#redirects), [Types](reference/mixer.md#types)
- [Mixer options](reference/mixer.md#options) and [basePath](reference/mixer.md#basepath)

## Understand the design

- [Safe by default](explanation/safety.md): what mixer gets right without extra code
- [Wrapping with next()](explanation/composition.md): how components compose
- [Architecture decision records](adr): why the design is the way it is

## Contribute

- [CONTRIBUTING.md](../CONTRIBUTING.md): setup, commands, tests, design principles, and code conventions
- [AGENTS.md](../AGENTS.md): instructions for AI coding agents working in this repository
