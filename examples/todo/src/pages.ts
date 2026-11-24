import { TITLE_LENGTH, type Todo } from './data.ts'
import { type Html, html, htmlResponse } from './html.ts'

function layout(title: string, body: Html, userName?: string): Html {
  return html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · mixer todo</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
<h1>mixer todo</h1>
${
  userName &&
  html`<form method="post" action="/logout"><span>${userName}</span> <button>Sign out</button></form>`
}
</header>
<main>
${body}
</main>
</body>
</html>`
}

export function loginPage(error?: string): Html {
  return layout(
    'Sign in',
    html`<h2>Sign in</h2>
${error && html`<p class="error">${error}</p>`}
<form method="post" action="/login">
<label>Name <input name="name" autocomplete="username" required></label>
<label>Password <input name="password" type="password" autocomplete="current-password" required></label>
<button>Sign in</button>
</form>`,
  )
}

export function listPage(userName: string, list: Todo[], error?: string): Html {
  return layout(
    'Todos',
    html`<h2>Todos</h2>
${error && html`<p class="error">${error}</p>`}
<form method="post" action="/todos">
<input name="title" maxlength="${TITLE_LENGTH}" required aria-label="New todo">
<button>Add</button>
</form>
<ul>
${list.map(
  (todo) => html`<li${todo.done ? html` class="done"` : ''}>
<form method="post" action="/todos/${todo.id}/toggle"><button>${todo.done ? 'Undo' : 'Done'}</button></form>
<span>${todo.title}</span>
<form method="post" action="/todos/${todo.id}/delete"><button>Delete</button></form>
</li>`,
)}
</ul>`,
    userName,
  )
}

export function errorPage(
  status: number,
  message: string,
  requestId: string | undefined,
): Response {
  const page = layout(
    `Error ${status}`,
    html`<h2>${status}</h2>
<p>${message}</p>
${requestId && html`<p>If you contact us, mention this ID: <code>${requestId}</code></p>`}`,
  )
  return htmlResponse(page, status)
}
