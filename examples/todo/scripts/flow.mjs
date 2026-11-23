// The flow a browser goes through, used to check the example on Bun and on workerd.
// `send(path, init)` sends one request to the running app and returns the Response.
export async function flow(send) {
  const jar = new Map()
  const request = async (path, init = {}) => {
    const headers = new Headers(init.headers)
    if (jar.size > 0) {
      headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
    }
    const res = await send(path, { ...init, headers, redirect: 'manual' })
    for (const line of res.headers.getSetCookie()) {
      const [name, value] = line.split(';')[0].split('=')
      if (/Max-Age=0/i.test(line)) jar.delete(name)
      else jar.set(name, value)
    }
    return res
  }
  const form = (path, fields, site = 'same-origin') =>
    request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': site,
      },
      body: new URLSearchParams(fields).toString(),
    })
  const check = (label, ok) => {
    if (!ok) throw new Error(`example flow failed: ${label}`)
  }

  const signedOut = await request('/')
  await signedOut.text()
  check('signed-out redirect', signedOut.status === 303)

  const login = await form('/login', { name: 'demo', password: 'demo' })
  await login.text()
  check('login', login.status === 303 && jar.size === 1)

  const added = await form('/todos', { title: '<b>milk</b>' })
  await added.text()
  check('add', added.status === 303)

  const list = await request('/')
  const page = await list.text()
  check('escaped list', page.includes('&lt;b&gt;milk&lt;/b&gt;'))
  check('no-store', list.headers.get('cache-control') === 'private, no-store')
  check(
    'request ID',
    /^[0-9a-f-]{36}$/.test(list.headers.get('x-request-id') ?? ''),
  )
  check(
    'CSP',
    (list.headers.get('content-security-policy') ?? '').includes(
      "default-src 'self'",
    ),
  )

  const forged = await form('/todos', { title: 'x' }, 'cross-site')
  await forged.text()
  check('cross-site POST', forged.status === 403)

  const logout = await form('/logout', {})
  await logout.text()
  check('logout', logout.status === 303 && jar.size === 0)
}
