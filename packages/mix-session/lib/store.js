module.exports = new class Store {
  constructor() {
    this.sessions = Object.create(null)
  }

  get(id) {
    let session = this.sessions[id]
    if (!session) return
    return session
  }

  set(id, session = Object.create(null)) {
    if (session) {
      this.sessions[id] = session
    }
  }

  delete(id) {
    delete this.sessions[id]
  }

  clear() {
    this.session = Object.create(null)
  }
}()
