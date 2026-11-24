# Receiving a webhook

English | [日本語](webhook.ja.md)

Receive payment notifications from another service, trusting only requests signed with a shared secret.

```ts
// examples/docs/src/webhook.ts

import { post } from '@imatomix/mix-router'
import { HttpError, Mixer, validateInput } from '@imatomix/mixer'
import { z } from 'zod'

const PaymentEvent = z.object({
  id: z.string(),
  type: z.literal('payment.succeeded'),
  amount: z.number().int(),
})

export type PaymentEvent = z.infer<typeof PaymentEvent>

interface WebhookOptions {
  secret: string
  onPayment: (event: PaymentEvent) => Promise<void>
}

export function createApp({ secret, onPayment }: WebhookOptions) {
  return new Mixer().mix(
    post('/webhooks/payments', async (ctx) => {
      const body = await ctx.bytes({ bodyLimit: 64 * 1024 })
      const signature = ctx.request.headers.get('x-signature')
      if (!(await verify(secret, body, signature))) throw new HttpError(401)

      // Only a body with a valid signature is parsed and trusted; ctx.json() reads the bytes already read
      const event = await validateInput(PaymentEvent, await ctx.json())

      // Answer at once, and handle the event after the response
      ctx.waitUntil(onPayment(event))
      return null
    }),
  )
}

/** Checks a hex HMAC-SHA256 of the body; crypto.subtle.verify compares in constant time */
async function verify(
  secret: string,
  body: Uint8Array,
  signature: string | null,
): Promise<boolean> {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const mac = Uint8Array.from(signature.match(/../g) ?? [], (hex) =>
    Number.parseInt(hex, 16),
  )
  return crypto.subtle.verify('HMAC', key, mac, body)
}
```

- The signature is checked before anything in the body is used. `crypto.subtle.verify` compares in constant time, so the time it takes does not reveal how much of a guess was right
- `bodyLimit` keeps the body small; a larger one answers `413` before it is read in full
- After the signature, `ctx.json()` reads the same bytes, and `validateInput()` accepts only the events the app knows (`422` otherwise)
- The answer (`204`) goes out at once and the event is handled after it with `ctx.waitUntil()`, so the sender does not time out. A failure there is reported like any other error
- On Cloudflare Workers, take the secret from `ctx.env` instead of passing it in. The tests are in [examples/docs/test/webhook.test.ts](../../examples/docs/test/webhook.test.ts)

See also: [Streaming and background work](../how-to/streaming-and-background-work.md#ctxwaituntil), [Reading and validating the request body](../how-to/request-body.md).
