import type { SessionData, SessionStore } from './store.js'

/**
 * Sends one Redis command and resolves with its reply, rejecting on a Redis error. Wrap the client you use:
 * node-redis `(args) => client.sendCommand(args)`, ioredis `([command, ...rest]) => client.call(command, ...rest)`,
 * Bun `([command, ...rest]) => client.send(command, rest)`
 */
export type RedisSend = (args: string[]) => Promise<unknown>

export interface RedisKeyOptions {
  /** Prepended to every key (defaults to `mix-session:`) */
  prefix?: string
  /**
   * Store under a SHA-256 hash of the session ID instead of the ID itself (defaults to true), so that a key seen
   * in a key listing, a monitor, a log, or a backup cannot be used to take over a session. Turn it off only to
   * share sessions with other software that reads the same keys
   */
  hashKeys?: boolean
}

export interface RedisStoreOptions extends RedisKeyOptions {
  send: RedisSend
}

const DEFAULT_PREFIX = 'mix-session:'

/** A SessionStore on Redis. Works with any client through `send`, and needs no dependency */
export function redisStore({
  send,
  ...keyOptions
}: RedisStoreOptions): SessionStore {
  const key = (id: string) => sessionKey(id, keyOptions)

  return {
    async get(id) {
      const reply = await send(['GET', await key(id)])
      if (reply === null) return undefined
      if (typeof reply !== 'string') throw unexpectedReply('GET', reply)
      return parseSession(reply)
    },
    async set(id, data, ttlSeconds) {
      const reply = await send([
        'SET',
        await key(id),
        JSON.stringify(data),
        'EX',
        seconds(ttlSeconds),
      ])
      if (reply !== 'OK') throw unexpectedReply('SET', reply)
    },
    async update(id, data, ttlSeconds) {
      // XX makes the existence check and the write one step: a session deleted meanwhile (a logout, or one that
      // expired) is not written back
      const reply = await send([
        'SET',
        await key(id),
        JSON.stringify(data),
        'EX',
        seconds(ttlSeconds),
        'XX',
      ])
      if (reply === null) return false
      if (reply !== 'OK') throw unexpectedReply('SET XX', reply)
      return true
    },
    async delete(id) {
      await send(['DEL', await key(id)])
    },
  }
}

/** The Redis key a session ID is stored under, for looking a session up by hand */
export async function sessionKey(
  id: string,
  { prefix = DEFAULT_PREFIX, hashKeys = true }: RedisKeyOptions = {},
): Promise<string> {
  if (!hashKeys) return `${prefix}${id}`
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(id),
  )
  return `${prefix}${base64url(new Uint8Array(digest))}`
}

function seconds(ttl: number): string {
  if (!Number.isInteger(ttl) || ttl < 1) {
    throw new RangeError(
      `mix-session redis: ttl must be a whole number of seconds of 1 or more: ${ttl}`,
    )
  }
  return String(ttl)
}

function parseSession(json: string): SessionData {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('mix-session redis: the stored session is not valid JSON')
  }
  // JSON.parse keeps "__proto__" as an own key, so the result cannot change Object.prototype
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      'mix-session redis: the stored session is not a JSON object',
    )
  }
  return data as SessionData
}

function unexpectedReply(command: string, reply: unknown): Error {
  const shown =
    typeof reply === 'string'
      ? JSON.stringify(reply.slice(0, 40))
      : typeof reply
  return new Error(
    `mix-session redis: unexpected reply to ${command}: ${shown}. send must resolve with the reply of one command`,
  )
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
