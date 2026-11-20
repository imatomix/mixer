const crypto = require('crypto')
const store = require('./store')

exports.save = (id, session, secret) => {
  const enc = encrypt(JSON.stringify(session), secret)
  store.set(id, enc)
}

exports.load = (id, secret) => {
  let session = store.get(id)
  if (typeof session === 'string') {
    session = JSON.parse(decrypt(session, secret))
  }
  return session
}

exports.delete = (id) => {
  store.delete(id)
}

exports.generateId = () => {
  return crypto.randomBytes(16).toString('hex')
}

function encrypt(value, secret) {
  const cipher = crypto.createCipher('aes-256-cbc', secret)
  let crypted = cipher.update(value, 'utf8', 'hex')
  crypted += cipher.final('hex')
  return crypted
}

function decrypt(value, secret) {
  const decipher = crypto.createDecipher('aes-256-cbc', secret)
  let decrypted = decipher.update(value, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
