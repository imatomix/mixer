import { describe, expect, it } from 'vitest'
import { createApp, type PaymentEvent } from '../src/webhook.ts'

const SECRET = 'test-secret'

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(body),
  )
  return Buffer.from(mac).toString('hex')
}

function setup() {
  const handled: PaymentEvent[] = []
  const work: Promise<unknown>[] = []
  const app = createApp({
    secret: SECRET,
    onPayment: async (event) => {
      handled.push(event)
    },
  })
  const send = (body: string, signature: string | null) =>
    app.fetch(
      new Request('http://localhost/webhooks/payments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(signature ? { 'x-signature': signature } : {}),
        },
        body,
      }),
      undefined,
      { waitUntil: (promise) => void work.push(promise) },
    )
  return { send, handled, work }
}

const EVENT = JSON.stringify({
  id: 'evt_1',
  type: 'payment.succeeded',
  amount: 1200,
})

describe('the webhook example', () => {
  it('accepts a correctly signed event and handles it after answering', async () => {
    const { send, handled, work } = setup()
    const res = await send(EVENT, await sign(EVENT))
    expect(res.status).toBe(204)
    await Promise.all(work)
    expect(handled).toEqual([JSON.parse(EVENT)])
  })

  it('rejects a missing or wrong signature before reading the event', async () => {
    const { send, handled } = setup()
    expect((await send(EVENT, null)).status).toBe(401)
    expect((await send(EVENT, await sign(EVENT, 'other-secret'))).status).toBe(
      401,
    )
    expect((await send(EVENT, 'not-hex')).status).toBe(401)
    expect(handled).toEqual([])
  })

  it('answers 422 for a signed body that is not a known event, 400 for broken JSON, and 413 for a large one', async () => {
    const { send } = setup()
    const unknown = JSON.stringify({ id: 'evt_2', type: 'refund' })
    expect((await send(unknown, await sign(unknown))).status).toBe(422)
    const broken = '{"id":'
    expect((await send(broken, await sign(broken))).status).toBe(400)
    const large = 'x'.repeat(70 * 1024)
    expect((await send(large, await sign(large))).status).toBe(413)
  })
})
