import { createClient } from 'redis'
import { afterAll, describe, expect, it } from 'vitest'
import { redisStore, sessionKey } from '../src/redis.js'
import { checkSessionStore } from '../src/testing.js'

const ID = 'A'.repeat(43)

/** Records the commands it receives and answers like Redis, without expiry */
function fakeRedis() {
  const values = new Map<string, string>()
  const commands: string[][] = []
  const send = async (args: string[]): Promise<unknown> => {
    commands.push(args)
    const [command, key = '', value = ''] = args
    switch (command) {
      case 'GET':
        return values.get(key) ?? null
      case 'SET':
        if (args.includes('XX') && !values.has(key)) return null
        values.set(key, value)
        return 'OK'
      case 'DEL':
        return values.delete(key) ? 1 : 0
      default:
        throw new Error(`unexpected command ${command}`)
    }
  }
  return { send, values, commands }
}

describe('keys', () => {
  it('stores under a hash of the session ID by default, so keys do not reveal IDs', async () => {
    const redis = fakeRedis()
    await redisStore({ send: redis.send }).set(ID, { user: 'mixer' }, 60)
    const key = redis.commands[0]?.[1] ?? ''
    expect(key).toMatch(/^mix-session:[A-Za-z0-9_-]{43}$/)
    expect(key).not.toContain(ID)
    expect(key).toBe(await sessionKey(ID))
  })

  it('stores under the ID itself with hashKeys: false, and uses the prefix', async () => {
    const redis = fakeRedis()
    await redisStore({ send: redis.send, prefix: 'app:', hashKeys: false }).set(
      ID,
      {},
      60,
    )
    expect(redis.commands[0]?.[1]).toBe(`app:${ID}`)
    expect(await sessionKey(ID, { prefix: 'app:', hashKeys: false })).toBe(
      `app:${ID}`,
    )
  })

  it('sends set as SET EX and update as SET EX XX, in whole seconds', async () => {
    const redis = fakeRedis()
    const store = redisStore({ send: redis.send })
    await store.set(ID, { v: 1 }, 60)
    expect(await store.update(ID, { v: 2 }, 120)).toBe(true)
    const key = await sessionKey(ID)
    expect(redis.commands).toEqual([
      ['SET', key, '{"v":1}', 'EX', '60'],
      ['SET', key, '{"v":2}', 'EX', '120', 'XX'],
    ])
  })

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects a ttl that is not a whole number of seconds of 1 or more (%s)',
    async (ttl) => {
      await expect(
        redisStore({ send: fakeRedis().send }).set(ID, {}, ttl),
      ).rejects.toThrow(/ttl/)
    },
  )
})

describe('replies', () => {
  it.each([
    ['GET', 42],
    ['GET', undefined],
    ['SET', 'QUEUED'],
    ['SET', 1],
  ])('throws for an unexpected %s reply (%j)', async (command, reply) => {
    const store = redisStore({ send: async () => reply })
    const call = command === 'GET' ? store.get(ID) : store.set(ID, {}, 60)
    await expect(call).rejects.toThrow(/unexpected reply/)
  })

  it.each(['not json', '[1,2]', 'null', '"text"'])(
    'throws for a stored value that is not a JSON object (%s)',
    async (stored) => {
      const store = redisStore({ send: async () => stored })
      await expect(store.get(ID)).rejects.toThrow(/stored session/)
    },
  )

  it('reads an own __proto__ key as data without touching Object.prototype', async () => {
    const store = redisStore({
      send: async () => '{"__proto__":{"polluted":true},"user":"mixer"}',
    })
    const data = await store.get(ID)
    expect(Object.hasOwn(data ?? {}, '__proto__')).toBe(true)
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })
})

const url = process.env.REDIS_URL

describe.skipIf(!url)('with a real Redis (REDIS_URL)', () => {
  const client = createClient(url ? { url } : {})
  const prefix = `mix-session-test:${crypto.randomUUID()}:`
  afterAll(async () => {
    if (client.isOpen) await client.quit()
  })

  it('follows the session store rules', { timeout: 10_000 }, async () => {
    await client.connect()
    await checkSessionStore(() =>
      redisStore({ send: (args) => client.sendCommand(args), prefix }),
    )
  })
})
