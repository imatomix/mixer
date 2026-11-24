# リクエストボディを読んで確かめる

[English](request-body.md) | 日本語

本文を JSON・フォーム・文字列・バイト列として読み、スキーマで確かめ、上限を決める。

## リクエストボディ

ルートが受け取るボディの種類を明示する。それぞれの読み方は自分の Content-Type だけを受け付け、それ以外は何も読まずに `415` を返す。

| メソッド | 受け付けるもの | 結果 |
| --- | --- | --- |
| `ctx.json()` | `application/json`、`application/*+json` | 解析した値。型は `unknown`（不正か空なら `400`） |
| `ctx.form()` | `application/x-www-form-urlencoded`、`multipart/form-data` | `FormData`。`get(name)`・`getAll(name)` で文字列、アップロードは `File` が得られる（不正なら `400`） |
| `ctx.text()` / `ctx.bytes()` | 何でも | 文字列 / `Uint8Array` |

そのため JSON のルートが、ブラウザが別のサイトから事前の確認なしに送れるフォームや `text/plain` を解析することはない。ただの別サイトのフォームから JSON のルートに届かなくなるが、Cookie に頼るルートの CSRF 対策の代わりにはならない。そうしたルートには mix-csrf を使う。

値はクライアントから来るので、使う前に確かめる。`ctx.json()` が `unknown` を返すのはそのため。

```ts
post('/todos', async (ctx) => {
  const form = await ctx.form()
  const title = form.get('title')
  if (typeof title !== 'string' || title.length === 0 || title.length > 200) {
    throw new HttpError(422, 'A title is between 1 and 200 characters')
  }
  // ...
})
```

スキーマのライブラリを使うときは、`validateInput()` で確かめる。[Standard Schema](https://standardschema.dev) に対応したスキーマ（Zod 3.24 以降、Valibot、ArkType など）を受け取り、スキーマの出力を型付きで返す。

```ts
import { validateInput } from '@imatomix/mixer'
import { z } from 'zod'

const NewItem = z.strictObject({ title: z.string().min(1).max(200), count: z.number().int() })

post('/api/items', async (ctx) => {
  const item = await validateInput(NewItem, await ctx.json()) // { title: string; count: number }
  // ...
})
```

- 合わないデータには `422` と `{ "error": "Invalid request data" }` を返し、障害としては報告しない。JSON の書き方が壊れていれば今までどおり `400`、Content-Type が違えば `415`、上限を超えれば `413`
- 何が違ったか（issues）は応答に載せない。そのメッセージにクライアントの値が入ることがあるため。見せたいときは `onError` で `error.issues` を読む：`if (error instanceof ValidationError) return Response.json({ issues: error.issues }, { status: 422 })`
- issues を返す代わりに例外を投げるスキーマは不具合なので、`500` になり報告される
- クライアントから来た値にだけ使う。設定や保存済みのデータが確認に通らないのはサーバー側の問題で、`422` ではない
- 知らないキーはスキーマで拒むか取り除く（上の `z.strictObject`）。`__proto__` のようなキーがアプリの奥まで届かないようにするため
- ほかの入力にも使える。フォームは `Object.fromEntries(await ctx.form())`（名前ごとに値は 1 つ。繰り返す項目は `getAll` を使う）、クエリは `Object.fromEntries(ctx.url.searchParams)`、ルートのパラメータはそのまま渡す

ボディは求められたときだけ読み、どの読み方も何度呼んでも同じ内容を返す。本文は `bodyLimit`（既定 3 MB）の範囲で全部メモリに読み込む。とても大きなファイルを流しながら保存する使い方には向かない。

あるルートだけ上限を変えるには、そのルートが本文を読むところで `bodyLimit` を渡す。ほかのルートにはアプリの上限が効いたままなので、アップロードのルートのために他のルートまで大きな本文を受け付けることはない。

```ts
post('/photos', async (ctx) => {
  const form = await ctx.form({ bodyLimit: 50 * 1024 * 1024 }) // このルートだけ
  // ...
})
post('/api/items', async (ctx) => {
  const item = await ctx.json({ bodyLimit: 64 * 1024 }) // 小さくしてもよい
  // ...
})
```

4 つの読み方すべてが受け取る。本文は 1 回しか読まないので、あとから小さい `bodyLimit` で読むと読んだ本文をそれで確かめ直し、ある読み方で断られた本文を、あとから大きい上限で読み直すことはできない。前段のプロキシ・CDN・WAF でもリクエストの大きさを制限できるが、アプリの上限は前段の有無に関係なく効く。
