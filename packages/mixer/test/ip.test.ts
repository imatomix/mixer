import { describe, expect, it } from 'vitest'
import { normalizeIp, parseProxies, resolveClientIp } from '../src/ip.js'

describe('normalizeIp', () => {
  it.each([
    ['127.0.0.1', '127.0.0.1'],
    ['::1', '::1'],
    ['::ffff:127.0.0.1', '127.0.0.1'],
    ['::FFFF:7f00:1', '127.0.0.1'],
    ['2001:DB8:0:0:0:0:0:1', '2001:db8::1'],
    ['[2001:db8::1]', '2001:db8::1'],
    [' 10.0.0.1 ', '10.0.0.1'],
  ])('normalizes %s to %s', (input, output) => {
    expect(normalizeIp(input)).toBe(output)
  })

  it.each([
    '',
    'localhost',
    '1.2.3',
    '256.0.0.1',
    '01.2.3.4',
    '0x7f.0.0.1',
    '1.2.3.4.5',
    'fe80::1%eth0',
    '1.2.3.4:80',
    '[::1]:80',
    'unknown',
    ':::1',
  ])('rejects %j', (input) => {
    expect(normalizeIp(input)).toBeUndefined()
  })
})

describe('parseProxies', () => {
  it.each([['10.0.0.0/8'], ['::1'], ['fd00::/8'], ['192.168.1.1']])(
    'accepts %s',
    (entry) => {
      expect(() => parseProxies([entry])).not.toThrow()
    },
  )

  it.each([
    '10.0.0.0/33',
    '::/129',
    'example.com',
    '10.0.0.0/',
    '10.0.0.0/8/8',
    '',
    '::ffff:0:0/95',
  ])('rejects %j', (entry) => {
    expect(() => parseProxies([entry])).toThrow(/trustedProxies/)
  })

  it('accepts IPv4-mapped IPv6 ranges as the IPv4 range they stand for', () => {
    const resolve = (entry: string, peer: string) =>
      resolveClientIp(peer, '198.51.100.7', parseProxies([entry]))
    expect(resolve('::ffff:10.0.0.0/104', '10.1.2.3')).toBe('198.51.100.7')
    expect(resolve('::ffff:10.0.0.0/104', '11.1.2.3')).toBe('11.1.2.3')
    expect(resolve('::ffff:10.0.0.1/128', '10.0.0.1')).toBe('198.51.100.7')
    expect(resolve('::ffff:10.0.0.1', '10.0.0.1')).toBe('198.51.100.7')
  })
})

describe('resolveClientIp', () => {
  const trusted = parseProxies(['10.0.0.0/8', '::1'])
  const resolve = (peer: string | undefined, forwardedFor: string | null) =>
    resolveClientIp(peer, forwardedFor, trusted)

  it('uses the direct peer when it is not a trusted proxy, ignoring X-Forwarded-For', () => {
    expect(resolve('203.0.113.9', '1.1.1.1')).toBe('203.0.113.9')
  })

  it('takes the rightmost untrusted address behind trusted proxies', () => {
    expect(resolve('10.0.0.2', '6.6.6.6, 198.51.100.7, 10.0.0.1')).toBe(
      '198.51.100.7',
    )
  })

  it('ignores forged values left of the first untrusted address', () => {
    expect(resolve('10.0.0.2', 'not-an-ip, 198.51.100.7')).toBe('198.51.100.7')
  })

  it('falls back to the peer when a hop that must be read is malformed', () => {
    expect(resolve('10.0.0.2', '198.51.100.7, garbage')).toBe('10.0.0.2')
  })

  it('takes the leftmost address when every hop is trusted', () => {
    expect(resolve('10.0.0.2', '10.0.0.5, 10.0.0.1')).toBe('10.0.0.5')
  })

  it('uses the peer when there is no X-Forwarded-For', () => {
    expect(resolve('::1', null)).toBe('::1')
  })

  it('treats an IPv4-mapped peer like the IPv4 address', () => {
    expect(resolve('::ffff:10.0.0.2', '198.51.100.7')).toBe('198.51.100.7')
  })

  it('falls back to the peer when X-Forwarded-For is too long or has too many hops', () => {
    expect(resolve('10.0.0.2', `${'1.1.1.1, '.repeat(40)}198.51.100.7`)).toBe(
      '10.0.0.2',
    )
    expect(resolve('10.0.0.2', 'x'.repeat(9_000))).toBe('10.0.0.2')
  })

  it('returns undefined without a valid peer', () => {
    expect(resolve(undefined, '198.51.100.7')).toBeUndefined()
    expect(resolve('nonsense', '198.51.100.7')).toBeUndefined()
  })

  it('uses only the peer when no proxies are trusted', () => {
    expect(resolveClientIp('10.0.0.2', '198.51.100.7', parseProxies([]))).toBe(
      '10.0.0.2',
    )
  })
})
