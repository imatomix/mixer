const session = require('./session')
const Cookie = require('./cookie')

module.exports = (options = {}) => (req, res) => {
  const generateId = typeof options.generateId === 'function'
    ? options.generateId : session.generateId

  req.sessionId = getSessionId(req, options.name)
  if (req.sessionId) {
    req.session = session.load(req.sessionId, options.secret)
    if (!req.session) {
      session.delete(req.sessionId)
      req.sessionId = generateId()
      req.session = Object.create(null)
    }
  } else {
    req.sessionId = generateId()
    req.session = Object.create(null)
  }

  const cookie = new Cookie(options.cookie)
  cookie.setHeader(res, options.name, req.sessionId)

  res.on('finish', () => {
    delete req.session.cookie
    if (Object.keys(req.session).length) {
      req.session.cookie = cookie
      session.save(req.sessionId, req.session, options.secret)
    } else {
      session.delete(req.sessionId)
    }
  })
}

getSessionId = (req, name) => {
  const cookie = req.headers.cookie
    ? req.headers.cookie.match(name + '=([^;]*)')
    : null

  if (!cookie) return

  const sid = cookie[0].split('=')[1]
  return sid
}
