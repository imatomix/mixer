# ユーザーのサインインとルートの前での確認

[English](auth-and-guards.md) | 日本語

サインインしたユーザーなど、いくつかのルートの前で 1 回確認し、その結果をルートに渡す。

## ルートの前で確認する

いくつかのルートが先に確認を必要とするとき（サインインしたユーザー、そのユーザーが属する組織など）は、ガードで 1 回確認し、結果を `ctx.state` に入れる。ガードは [namespace](https://github.com/imatomix/mixer/blob/main/packages/mix-router/README.ja.md#namespace-の中のコンポーネント) の最初に書く。そうすると、どのルートにも合わないパスを含め、そのプレフィックスの下のすべてのリクエストで動く。ルートでは、値がなければ例外を投げる小さな `requireX(ctx)` 補助関数で取り出す。ガードを置き忘れたりルートより後ろに置いたりしても、`undefined` のまま進まずに大きく失敗する。

誰がリクエストしたかで中身が変わる応答は、共有キャッシュに置かせてはいけない。ガードで `await next()` のあとに `Cache-Control` を付けると、エラーも含めてガードの下のすべての応答に届く。`private` は共有キャッシュに保存させず、`no-store` はどのキャッシュにも保存させない。mixer が自分で応答を private にするのは Cookie を付けるときだけで、mix-session はセッションのある応答に付ける。値を読むだけのガードでは、どちらも起きない。ガードが `next()` の前に返す応答（リダイレクトなど）がリクエストによって変わるなら、それにも別に付ける。

例として、ユーザーのサインイン。mixer はパスワードの確認や ID プロバイダーとのやり取りをしない。それには認証ライブラリを使う。mixer は、そのまわりの部品（セッション、CSRF 対策、安全な Cookie、上のキャッシュの扱い）とガードを用意する。

```ts
import { HttpError, redirect } from '@imatomix/mixer'
import { all, createRouter } from '@imatomix/mix-router'

type User = { id: string; name: string }
type State = { user?: User }
const { get, namespace } = createRouter<State>()

function requireUser(ctx: { state: State }): User {
  if (!ctx.state.user) throw new HttpError(401)
  return ctx.state.user
}

app.mix(
  // Web の Request を受けて Response を返すライブラリは、ルートとしてつなげる（ここでは Better Auth）
  all('/api/auth/*', (ctx) => auth.handler(ctx.request)),
  namespace('/app')(
    async (ctx, next) => {
      const result = await auth.api.getSession({ headers: ctx.request.headers })
      if (!result) return redirect('/login', { status: 303 })
      ctx.state.user = result.user
      await next()
      // 1 人のユーザー向けのページを共有キャッシュに置かせない
      ctx.headers.set('Cache-Control', 'private, no-store')
    },
    get('/', (ctx) => `hello ${requireUser(ctx).name}`),
  ),
)
```

- `ctx.request` をライブラリに渡すルートより前で、リクエストの本文を読まない。本文は 1 回しか読めない
- 自分のセッションの Cookie を持つライブラリなら、サインインのために mix-session はいらない。代わりに mix-session を使うなら、サインインしたときに `ctx.state.session.regenerate()` を呼ぶ
- Node.js の `req`/`res` を前提に作られたライブラリ（Passport など）は、Web の `Request`/`Response` では動かない

ほかの値も同じ形で扱える。このガードの後ろに 2 つ目のガードを置いて、サインインしたユーザーが属する組織を調べて `ctx.state.org` に入れ、ルートでは `requireOrg(ctx)` を呼ぶ。

ルートがこの形で値を受け取る理由は [ADR 0002](https://github.com/imatomix/mixer/blob/main/docs/adr/0002-signed-in-user-in-routes.md) を参照。
