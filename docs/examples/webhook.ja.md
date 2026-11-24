# Webhook を受け取る

[English](webhook.md) | 日本語

ほかのサービスから支払いの通知を受け取る。共有の秘密の値で署名されたリクエストだけを信用する。

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

      // 署名が正しい本文だけを解析して信用する。ctx.json() はすでに読んだバイト列を使う
      const event = await validateInput(PaymentEvent, await ctx.json())

      // すぐに応答し、イベントは応答のあとで処理する
      ctx.waitUntil(onPayment(event))
      return null
    }),
  )
}

/** 本文の HMAC-SHA256 を 16 進で確かめる。crypto.subtle.verify は一定時間で比べる */
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

- 本文の中身を使う前に署名を確かめる。`crypto.subtle.verify` は一定時間で比べるので、かかる時間から推測がどこまで当たったかを知られない
- `bodyLimit` で本文を小さく保つ。それより大きければ、全部読む前に `413` を返す
- 署名のあと、`ctx.json()` で同じバイト列を読み、`validateInput()` でアプリが知っているイベントだけを受け付ける（それ以外は `422`）
- 応答（`204`）はすぐに返し、イベントは `ctx.waitUntil()` で応答のあとに処理するので、送り手が時間切れにならない。そこでの失敗も、ほかのエラーと同じく報告される
- Cloudflare Workers では、秘密の値を引数で渡す代わりに `ctx.env` から取る。テストは [examples/docs/test/webhook.test.ts](../../examples/docs/test/webhook.test.ts)

関連: [ストリームと応答のあとの処理](../how-to/streaming-and-background-work.ja.md#ctxwaituntil)、[リクエストボディを読んで確かめる](../how-to/request-body.ja.md)
