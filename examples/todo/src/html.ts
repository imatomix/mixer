const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Markup that is already safe to put into a page, as produced by html`...` */
export class Html {
  readonly value: string
  constructor(value: string) {
    this.value = value
  }
  toString(): string {
    return this.value
  }
}

/**
 * Builds markup, escaping every interpolated value unless it is Html itself. Escaping covers text and quoted
 * attribute values; never interpolate into an unquoted attribute, a URL that users control, or a script
 */
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Html {
  let out = strings[0] ?? ''
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? '')
  })
  return new Html(out)
}

function render(value: unknown): string {
  if (value instanceof Html) return value.value
  if (Array.isArray(value)) return value.map(render).join('')
  if (value === null || value === undefined || value === false) return ''
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

export function htmlResponse(body: Html, status = 200): Response {
  return new Response(`<!doctype html>\n${body}`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
