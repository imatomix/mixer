const http = require('http')
const { Stream } = require('stream')

let server = null

module.exports = class mixer {
  constructor(fn) {
    this.components = []
    if (fn) this.components.push(fn)
    server = http.createServer()
    console.log("Hello Mixer")
  }

  listen(...args) {
    server.on('request', async (req, res) => {
      addSendFn(res)
      for (const component of this.components) {
        const goal = Boolean(await component(req, res))
        if (goal) break
      }
    })
    server.listen(...args)
  }

  mix(...fns) {
    this.components.push(...fns)
    return this
  }
}

function addSendFn(res) {
  res.post = (code, obj = null) => {
    if (!obj) {
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

    res.setHeader('Content-Length', Buffer.byteLength(obj))
    res.end(obj)
  }
}