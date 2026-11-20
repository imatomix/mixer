import { afterEach } from 'vitest'
import { Mixer, type MixerOptions, type State } from '../src/index.js'

const running: Mixer<State>[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close()))
})

export async function serve<S extends State = State>(
  setup: (app: Mixer<S>) => void,
  options?: MixerOptions<S>,
): Promise<string> {
  const app = new Mixer<S>(options)
  setup(app)
  await app.listen(0, '127.0.0.1')
  running.push(app as unknown as Mixer<State>)
  return `http://127.0.0.1:${app.address?.port}`
}
