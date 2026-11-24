import { isAbsolute, relative, sep } from 'node:path'
import { HttpError } from '@imatomix/mixer'

export function splitSegments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

/**
 * Leading and trailing slashes are allowed, but paths with an empty segment in the middle (`//`) are not served.
 * Ignoring empty segments would serve `//admin/x` as `/admin/x`,
 * which disagrees with other layers that authorize by a prefix of the raw path
 */
export function requestSegments(pathname: string): string[] | undefined {
  const parts = pathname.split('/').slice(1)
  if (parts.at(-1) === '') parts.pop()
  return parts.includes('') ? undefined : parts
}

export function isValidIndexName(name: string): boolean {
  return name !== '' && !name.startsWith('.') && !/[/\\\0]/.test(name)
}

export function hasDotSegment(path: string): boolean {
  return path.split(sep).some((segment) => segment.startsWith('.'))
}

export function decodePrefixSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new TypeError(
      `mix-static: invalid percent-encoding in prefix: ${JSON.stringify(segment)}`,
    )
  }
}

export function decodeSegments(rawSegments: string[]): string[] | undefined {
  const segments: string[] = []
  for (const raw of rawSegments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      throw new HttpError(400, 'Malformed URL')
    }
    // Segments that contain separators or NUL after decoding could change how the path is interpreted, so they are not served
    if (/[/\\\0]/.test(decoded)) return undefined
    segments.push(decoded)
  }
  return segments
}

export function startsWithPrefix(
  segments: string[],
  prefix: string[],
): boolean {
  return prefix.every((segment, i) => segments[i] === segment)
}

export function isServableSegment(segment: string, dotfiles: boolean): boolean {
  if (segment === '.' || segment === '..') return false
  return dotfiles || !segment.startsWith('.')
}

export function isInside(rootPath: string, target: string): boolean {
  const path = relative(rootPath, target)
  // Compare whole segments: a file named `..foo` inside root is fine, `../foo` is outside
  const outside = path === '..' || path.startsWith(`..${sep}`)
  return path !== '' && !outside && !isAbsolute(path)
}
