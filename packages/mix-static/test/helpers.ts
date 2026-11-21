import { type Component, Mixer } from '@imatomix/mixer'
import { afterEach } from 'vitest'

const running: Mixer[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()))
})

export async function serve(...components: Component[]): Promise<string> {
  const app = new Mixer().mix(...components)
  await app.listen(0, '127.0.0.1')
  running.push(app)
  return `http://127.0.0.1:${app.address?.port}`
}
