const defaults = {
  origin: '*',
  allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Accept', 'Content-Type'],
  allowCredentials: true,
  maxAge: 60 * 60 * 24 // 24hour
}

module.exports = (options = {}) => (req, res) => {
  options = { ...defaults, ...options }

  res.setHeader('Access-Control-Allow-Origin', options.origin)
  if (options.allowCredentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  if (options.exposeHeaders && options.exposeHeaders.length) {
    res.setHeader(
      'Access-Control-Expose-Headers',
      toHeaderString(options.exposeHeaders)
    )
  }

  /* preflight */
  if (req.method === 'OPTIONS') {
    res.setHeader(
      'Access-Control-Allow-Methods',
      toHeaderString(options.allowMethods)
    )
    if (options.allowHeaders.length) {
      res.setHeader(
        'Access-Control-Allow-Headers',
        toHeaderString(options.allowHeaders)
      )
    }
    res.setHeader('Access-Control-Max-Age', String(options.maxAge))
    res.statusCode = 204
  }
}

function toHeaderString(value) {
  if (Array.isArray(value)) {
    return value.join()
  }
  return String(value)
}