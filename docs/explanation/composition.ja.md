# next() によるコンポーネントの組み立て

[English](composition.md) | 日本語

コンポーネントが後ろのコンポーネントを包む仕組み。なぜこの形なのかは [ADR 0001](../adr/0001-compose-components-with-next.md) を参照。

コンポーネントは 2 つ目の引数に `next` を受け取る。`await next()` は後ろのコンポーネントを実行し、それが作った `Response` を返す。後ろで起きたエラーはすでにエラーの応答（`onError` か既定のもの）に変わっているので、`next()` は例外を投げない。エラーそのものは `ctx.error` に残る。

```ts
app.mix(
  async (ctx, next) => {
    await db.begin()
    await next()
    // 投げられたエラーは ctx.error に入る。ハンドラーが意図して返した 500 はエラーではない
    if (ctx.error === undefined) await db.commit()
    else await db.rollback()
  },
  post('/orders', createOrder),
)
```

規則:

- `await next()` のあと、`ctx.headers`・`ctx.cookies`・`ctx.status` は返ってきた応答のものになるので、ヘッダーや Cookie はこれまでどおり足せる。`next()` のあとは `ctx.headers` を改めて使う。`next()` の前に手元に持った参照は、古い下書きを指したまま
- `next()` のあとは、何も返さず応答をそのまま使うか、新しい `Response` を丸ごと返す。それ以外の値を返すと `500` になる。古い応答の `Content-Type` や `Content-Length` のまま送られてしまうため
- `next()` は 1 回だけ呼び、`await` する。2 回呼ぶ、返したあとに呼ぶ、後ろが動いている途中で返す、のどれも `500` になる
- **すべての応答にヘッダーや Cookie を届けるコンポーネントは最初に置く**。mix-logger・mix-secure-headers・mix-cors・mix-session など。それより外側に置いたコンポーネントが応答を差し替えると、それらが足したものは消える
- mixer 自身が保証するもの（`nosniff`、Cookie 付きの応答を共有キャッシュに置かせないこと、`HEAD`・`204`・`304` に本文を付けないこと）は、すべてのコンポーネントのあとで適用するので、どのコンポーネントも取り消せない

規則が扱わないことが 2 つある。`next()` は受け取ったコンポーネントの中だけで使う（別のリクエストから呼ぶと、元のリクエストのコンポーネントが動く）。例外を投げたコンポーネントは、自分が付けるはずだったものを失う。エラーの応答はその外側で作られるため。mix-cors の `origin` や mix-logger の `requestId` のように、モジュールが呼ぶ関数は例外を投げないようにする。

`compose(...components)` は、並びを 1 つのまとまりとして同じ規則で実行する。中の `next()` は、まとまりの残りを実行し、そのあとに続くものを実行する。mix-router の `group` はこれで作られているので、group の中のコンポーネントはアプリのその部分だけを包む。`/api` の下だけ JSON のエラーページにする、など。
