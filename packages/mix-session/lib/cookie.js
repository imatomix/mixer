module.exports = class Cookie {
  constructor(options = {}) {
    this.expires = options.expires
    this.maxAge = options.maxAge
    this.domain = options.domain
    this.path = options.path || '/'
    this.expires = options.expires
    this.httpOnly = options.httpOnly || true
    this.secure = options.secure
    this.sameSite = options.sameSite
  }

  setHeader(res, name, value) {
    const data = this.serialize(name, value)
    let cookie = res.getHeader('Set-Cookie') || []
    cookie = Array.isArray(cookie) ? cookie.concat(data) : [cookie, data]

    res.setHeader('Set-Cookie', cookie)
  }

  serialize(name, value) {
    let cookie = name + '=' + encodeURIComponent(value)

    if (this.expires) {
      cookie += '; expires=' + this.expires.toUTCString()
    }

    if (this.maxAge) {
      cookie += '; Max-Age=' + Math.floor(this.maxAge)
    }

    if (this.domain) {
      cookie += '; Domain=' + this.domain
    }

    if (this.path) {
      cookie += '; Path=' + this.path
    }

    if (this.expires) {
      cookie += '; Expires=' + this.expires.toUTCString()
    }

    if (this.httpOnly) {
      cookie += '; HttpOnly'
    }

    if (this.secure) {
      cookie += '; Secure'
    }

    if (this.sameSite) {
      cookie += '; SameSite=' + this.sameSite
    }

    return cookie
  }
}
