const qs = require('querystring')

exports.buffer = async (req, limit) => {
  return await getBodyData(req, limit)
    .then(buffer => {
      return buffer
    })
    .catch(error => {
      console.log(error)
    })
}

exports.text = (req, limit) => {
  return exports.buffer(req, limit)
    .then(buffer => {
      return buffer.toString()
    })
}

exports.json = (req, limit) => {
  return exports.buffer(req, limit)
    .then(buffer => {
      return qs.parse(buffer)
    })
}

function getBodyData(req, limit = 1024 * 1024 * 3) {
  return new Promise((resolve, reject) => {
    let data = ''
    req
      .on('readable', () => {
        data += req.read() || ''
        if (data.length > limit) {
          reject(new Error('request entity too large'))
        }
      })
      .on('end', () => {
        resolve(data)
      })
      .on('error', error => {
        reject(error)
      })
  })
}
