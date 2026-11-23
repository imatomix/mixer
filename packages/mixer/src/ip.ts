/** An IP address as bytes: 4 for IPv4, 16 for IPv6 */
interface Address {
  bytes: Uint8Array
}

export interface ProxyRange extends Address {
  prefix: number
}

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const MAX_FORWARDED_LENGTH = 8 * 1024
const MAX_FORWARDED_HOPS = 32

/**
 * Normalizes an IP address: dotted IPv4 (an IPv4-mapped IPv6 address becomes IPv4), or IPv6 in its canonical
 * form. Anything else, including a zone (`%eth0`) or a port, is undefined
 */
export function normalizeIp(text: string): string | undefined {
  const address = parse(text)
  return address && format(address)
}

/** Parses trustedProxies: IP addresses or CIDR ranges such as `10.0.0.0/8` */
export function parseProxies(entries: readonly string[]): ProxyRange[] {
  return entries.map((entry) => {
    const [text = '', prefixText, ...rest] = entry.split('/')
    const address = parse(text)
    const bits = (address?.bytes.length ?? 0) * 8
    const prefix = prefixText === undefined ? bits : Number(prefixText)
    if (
      !address ||
      rest.length > 0 ||
      (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) ||
      prefix > bits
    ) {
      throw new TypeError(
        `mixer: trustedProxies takes IP addresses or CIDR ranges such as 10.0.0.0/8: ${JSON.stringify(entry)}`,
      )
    }
    return { bytes: address.bytes, prefix }
  })
}

/**
 * The client address for a direct peer. X-Forwarded-For is read only when the peer is a trusted proxy: from the
 * right, trusted proxies are skipped and the first other address is the client. Values left of it may be forged
 * and are ignored; a hop that has to be read but is malformed, or a header over the limits, falls back to the peer
 */
export function resolveClientIp(
  peer: string | undefined,
  forwardedFor: string | null,
  trusted: readonly ProxyRange[],
): string | undefined {
  const direct = peer === undefined ? undefined : parse(peer)
  if (!direct) return undefined
  if (!isTrusted(direct, trusted) || forwardedFor === null) {
    return format(direct)
  }
  if (forwardedFor.length > MAX_FORWARDED_LENGTH) return format(direct)
  const hops = forwardedFor.split(',')
  if (hops.length > MAX_FORWARDED_HOPS) return format(direct)

  let client = direct
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = parse(hops[i] ?? '')
    if (!hop) return format(direct)
    client = hop
    if (!isTrusted(hop, trusted)) break
  }
  return format(client)
}

function isTrusted(address: Address, trusted: readonly ProxyRange[]): boolean {
  return trusted.some(
    (range) =>
      range.bytes.length === address.bytes.length &&
      samePrefix(range.bytes, address.bytes, range.prefix),
  )
}

function samePrefix(a: Uint8Array, b: Uint8Array, bits: number): boolean {
  const whole = Math.floor(bits / 8)
  for (let i = 0; i < whole; i++) if (a[i] !== b[i]) return false
  const rest = bits % 8
  if (rest === 0) return true
  const mask = (0xff << (8 - rest)) & 0xff
  return ((a[whole] ?? 0) & mask) === ((b[whole] ?? 0) & mask)
}

function parse(input: string): Address | undefined {
  const text = input.trim()
  const v4 = IPV4.exec(text)
  if (v4) return { bytes: Uint8Array.from(v4.slice(1, 5), Number) }

  const inner =
    text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text
  // A zone (%eth0) only means something on the host that set it, so it is not accepted
  if (!inner.includes(':') || !/^[0-9A-Fa-f:.]+$/.test(inner)) return undefined
  let canonical: string
  try {
    // The URL parser is the standard IPv6 parser, available on every runtime
    canonical = new URL(`http://[${inner}]`).hostname.slice(1, -1)
  } catch {
    return undefined
  }
  const bytes = expand(canonical)
  const mapped =
    bytes.subarray(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  return { bytes: mapped ? bytes.slice(12) : bytes }
}

/** Expands the canonical IPv6 form URL gives (hexadecimal groups, at most one `::`) into 16 bytes */
function expand(canonical: string): Uint8Array {
  const [head = '', tail] = canonical.split('::')
  const groups = (part: string) => (part === '' ? [] : part.split(':'))
  const left = groups(head)
  const right = tail === undefined ? [] : groups(tail)
  const all = [
    ...left,
    ...Array(8 - left.length - right.length).fill('0'),
    ...right,
  ]
  const bytes = new Uint8Array(16)
  all.forEach((group, i) => {
    const value = Number.parseInt(group, 16)
    bytes[i * 2] = value >> 8
    bytes[i * 2 + 1] = value & 0xff
  })
  return bytes
}

function format({ bytes }: Address): string {
  if (bytes.length === 4) return bytes.join('.')
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) {
    groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16))
  }
  return new URL(`http://[${groups.join(':')}]`).hostname.slice(1, -1)
}
