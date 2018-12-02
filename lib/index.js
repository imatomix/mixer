const http = require('http')
const { json } = require('./body-parser.js')

let server = null

module.exports = class Mixer {
  constructor(fn) {
    this.components = fn ? [fn] : []
    server = http.createServer()
  }

  listen(...args) {
    server.on('request', async (req, res) => {
      req.body = await json(req)
      res.send = send(res)

      for (const component of this.components) {
        const result = await component(req, res)

        if (res.finished) break
        if (result) {
          res.send(res.statusCode || 200, result)
          break
        }
      }
    })
    server.listen(...args)
  }

  mix(...fns) {
    this.components.push(...fns)
    return this
  }
}

function send(res) {
  return (code, obj = null) => {
    if (!obj) {
      res.statusCode = 204
      res.end()
      return
    }

    if (Buffer.isBuffer(obj)) {
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', obj.length)
      res.end(obj)
      return
    }

    if (typeof obj === 'object' || typeof obj === 'number') {
      obj = JSON.stringify(obj)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
    }

    res.statusCode = code
    res.setHeader('Content-Length', Buffer.byteLength(obj))
    res.end(obj)
  }
}