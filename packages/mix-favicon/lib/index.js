const { stat, createReadStream } = require('fs')
const { join, resolve } = require('path')
const { promisify } = require('util')

const asyncStat = promisify(stat)

module.exports = (path = './') => (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return

  if (req.url === '/favicon.ico') {
    path = resolve(path)

    return sendFavicon(res, path)
  }
}

async function sendFavicon(res, filePath) {
  return await asyncStat(filePath)
    .then(async stat => {
      if (stat.isDirectory()) {
        filePath = join(filePath, 'favicon.ico')
        return sendFavicon(res, filePath)
      }
      res.setHeader('Content-Length', stat.size)

      return await asyncStreamPipe(res, filePath)
        .then(result => result)
        .catch(error => {
          console.log(error)
        })
    })
    .catch(error => {
      res.statusCode = 404
      res.end()
    })
}

function asyncStreamPipe(res, filePath) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream
      .pipe(res)
      .on('error', error => {
        reject(error)
      }).on('finish', () => {
        resolve(true)
      })
  })
}