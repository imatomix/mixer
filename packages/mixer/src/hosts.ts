import { normalizeIp } from './ip.js'

/**
 * Whether a Host header is a single, plain host[:port]: a name or bracketed IPv6 address and a port of 1–65535.
 * Comparing with the URL parser's output instead would reject valid spellings such as an explicit default port (:80)
 */
export function isHostHeader(host: string): boolean {
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(host)
  if (!match) return false
  const port = match[2]
  return port === undefined || (Number(port) >= 1 && Number(port) <= 65535)
}

/**
 * Accepting only known host names defeats DNS rebinding (a page on another site reaching this server through
 * a name that resolves to it) and keeps a forged Host out of ctx.url
 */
export function createHostCheck(
  allowedHosts: readonly string[] | true | undefined,
  hostname: string,
): (host: string) => boolean {
  if (allowedHosts === true) return () => true
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]'])
  const listening = canonicalIp(hostname)
  if (listening && listening !== '0.0.0.0' && listening !== '[::]') {
    allowed.add(listening)
  }
  for (const entry of allowedHosts ?? []) {
    const name = canonicalIp(entry) ?? normalizeHost(entry)
    if (!name || !/^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/.test(name)) {
      throw new TypeError(
        `mixer: allowedHosts takes host names without a port or wildcard: ${JSON.stringify(entry)}`,
      )
    }
    allowed.add(name)
  }
  return (host) => allowed.has(host) || host.endsWith('.localhost')
}

/**
 * The form URL gives an IP address (IPv6 in brackets), so that both spellings compare equal. A zone such as
 * `%eth0` is dropped: Node can listen on a scoped address, but URL rejects one and Host never carries it
 */
function canonicalIp(value: string): string | undefined {
  const bare = value.replace(/^\[(.*)\]$/, '$1').replace(/%.*$/, '')
  const ip = normalizeIp(bare)
  if (ip === undefined) return undefined
  return new URL(`http://${bare.includes(':') ? `[${bare}]` : bare}`).hostname
}

export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '')
}
