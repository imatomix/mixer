# mixer documentation

English | [日本語](README.ja.md)

Where to find what, by what you want to do. Pages are being split out of the mixer README; until a topic has its own page, its link points into the README.

## Start

- [Quick start](../packages/mixer/README.md#quick-start): install mixer and answer your first request
- [Recommended stacks](../README.md#recommended-stacks): the modules to combine for a browser app and for a JSON API
- [Example app](../examples/todo): a todo app with sign-in, sessions, CSRF protection, and security headers, running on Node.js, Bun, and Cloudflare Workers

## Run your app

- [Node.js](../packages/mixer/README.md#nodejs), [Bun](../packages/mixer/README.md#bun), and [Cloudflare Workers](../packages/mixer/README.md#cloudflare-workers)
- [Inside another framework](../packages/mixer/README.md#inside-frameworks) such as Next.js, Nuxt, SvelteKit, or React Router
- [Behind a proxy](../packages/mixer/README.md#client-ip-address): the client's IP address and `trustedProxies`

## Do common tasks

- Routes, groups of routes, and `405`: [mix-router](../packages/mix-router)
- Mount a whole app, mixer or another framework: [mount](../packages/mix-router/README.md#mount)
- Sign users in and check them before routes: [Guarding routes](../packages/mixer/README.md#guarding-routes)
- Read and validate the request body: [Request body](../packages/mixer/README.md#request-body)
- Send Server-Sent Events: [Server-Sent Events](../packages/mixer/README.md#server-sent-events)
- Handle slow work and run work after the response: [Slow work](../packages/mixer/README.md#slow-work), [ctx.waitUntil()](../packages/mixer/README.md#ctxwaituntil)
- Sessions: [mix-session](../packages/mix-session) · CSRF protection: [mix-csrf](../packages/mix-csrf) · Security headers: [mix-secure-headers](../packages/mix-secure-headers) · CORS: [mix-cors](../packages/mix-cors)
- Static files: [mix-static](../packages/mix-static) · Request logs: [mix-logger](../packages/mix-logger) · Compression: [mix-compress](../packages/mix-compress)

## Look things up

- [Components](../packages/mixer/README.md#components) and [ctx](../packages/mixer/README.md#ctx)
- [What a component can return](../packages/mixer/README.md#what-a-component-can-return) and [Returning a Response](../packages/mixer/README.md#returning-a-response)
- [Errors](../packages/mixer/README.md#errors) and [Error reports](../packages/mixer/README.md#error-reports)
- [Cookies](../packages/mixer/README.md#cookies), [Redirects](../packages/mixer/README.md#redirects), [Types](../packages/mixer/README.md#types)
- [Mixer options](../packages/mixer/README.md#options) and [basePath](../packages/mixer/README.md#basepath)

## Understand the design

- [Safe by default](explanation/safety.md): what mixer gets right without extra code
- [Wrapping with next()](explanation/composition.md): how components compose
- [Architecture decision records](adr): why the design is the way it is

## Contribute

- [CONTRIBUTING.md](../CONTRIBUTING.md): setup, commands, tests, design principles, and code conventions
- [AGENTS.md](../AGENTS.md): instructions for AI coding agents working in this repository
