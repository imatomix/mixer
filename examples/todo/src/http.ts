import { HttpError, redirect } from '@imatomix/mixer'

/** After a POST, send the browser to a page with GET, so reloading does not send the form again */
export function seeOther(path: string): Response {
  return redirect(path, { status: 303 })
}

/** One text field from a form; a missing field or a file is a malformed request */
export function field(form: FormData, name: string): string {
  const value = form.get(name)
  if (typeof value !== 'string') {
    throw new HttpError(400, `The form field "${name}" is missing`)
  }
  return value
}
