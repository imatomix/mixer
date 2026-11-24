// Checks the Markdown documentation: relative links and their anchors resolve, links to this repository on
// GitHub (blob/tree/main) resolve to files and anchors in the working tree, and every page that has a Japanese
// twin (`x.md` and `x.ja.md`) keeps the same headings and the same code: only comments may be translated.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const root = join(import.meta.dirname, '..')
const GITHUB = 'https://github.com/imatomix/mixer/'

/** Pages that must have a Japanese twin; ADRs, CONTRIBUTING, and AGENTS are English only */
const NEEDS_JAPANESE =
  /^(README|packages\/[^/]+\/README|examples\/[^/]+\/README|docs\/(?!adr\/).+)\.md$/

function markdownFiles(dir) {
  const found = []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...markdownFiles(path))
    else if (entry.name.endsWith('.md')) found.push(path)
  }
  return found
}

/** Text outside fenced code blocks, so that `# comments` in shell examples are not taken for headings */
function prose(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '')
}

/** Each code block without comments, which are the only part of the code a translation may change */
function codeBlocks(text) {
  return [...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)].map(
    ([, info, code]) =>
      withoutComments(code, /^(sh|bash|shell)\b/.test(info) ? '#' : '//')
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.trim() !== '')
        .join('\n'),
  )
}

/**
 * Removes comments outside string literals, so that a URL such as 'https://example.com' and the code after it are
 * still compared. `style` is '//' for JavaScript (with block comments) or '#' for shell
 */
function withoutComments(code, style) {
  let out = ''
  let quote = ''
  for (let i = 0; i < code.length; i++) {
    const char = code[i]
    if (quote) {
      out += char
      if (char === '\\') out += code[++i] ?? ''
      else if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      out += char
      continue
    }
    const lineComment =
      style === '//'
        ? code.startsWith('//', i)
        : char === '#' && (i === 0 || /\s/.test(code[i - 1] ?? ''))
    if (lineComment) {
      while (i < code.length && code[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (style === '//' && code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2)
      i = end === -1 ? code.length : end + 1
      continue
    }
    out += char
  }
  return out
}

/** Heading anchors as GitHub makes them, including the -1, -2 suffixes for repeated headings */
const anchorCache = new Map()
function anchors(file) {
  let set = anchorCache.get(file)
  if (set) return set
  set = new Set()
  const seen = new Map()
  for (const [, title] of prose(
    readFileSync(join(root, file), 'utf8'),
  ).matchAll(/^#{1,6} (.+)$/gm)) {
    const base = title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
      .replaceAll(' ', '-')
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    set.add(count === 0 ? base : `${base}-${count}`)
  }
  anchorCache.set(file, set)
  return set
}

function headingLevels(text) {
  return [...prose(text).matchAll(/^(#{1,6}) /gm)].map(
    ([, hashes]) => hashes.length,
  )
}

const problems = []
const files = [
  ...markdownFiles('.').filter((file) => !file.includes('/')),
  ...markdownFiles('docs'),
  ...markdownFiles('packages'),
  ...markdownFiles('examples'),
]

for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8')
  for (const [, link] of prose(text).matchAll(/\]\(([^)\s]+)\)/g)) {
    let target
    let anchor
    if (link.startsWith(GITHUB)) {
      const match = link
        .slice(GITHUB.length)
        .match(/^(?:blob|tree)\/main\/([^#]*)(?:#(.+))?$/)
      if (!match) continue
      target = normalize(match[1].replace(/\/$/, '') || '.')
      anchor = match[2]
    } else if (/^[a-z]+:/i.test(link)) {
      continue
    } else {
      const [path, fragment] = link.split('#')
      target = path ? normalize(join(dirname(file), path)) : file
      anchor = fragment
    }
    if (!existsSync(join(root, target))) {
      problems.push(`${file}: ${link} points to a missing file`)
      continue
    }
    if (anchor && statSync(join(root, target)).isFile()) {
      if (!anchors(target).has(decodeURIComponent(anchor))) {
        problems.push(
          `${file}: ${link} points to a missing heading in ${target}`,
        )
      }
    }
  }

  if (file.endsWith('.ja.md')) continue
  const twin = file.replace(/\.md$/, '.ja.md')
  if (!existsSync(join(root, twin))) {
    if (NEEDS_JAPANESE.test(file))
      problems.push(`${file}: no Japanese version ${twin}`)
    continue
  }
  const japanese = readFileSync(join(root, twin), 'utf8')
  if (headingLevels(text).join() !== headingLevels(japanese).join()) {
    problems.push(`${file} and ${twin}: the headings differ in number or level`)
  }
  if (
    codeBlocks(text).join('\n---\n') !== codeBlocks(japanese).join('\n---\n')
  ) {
    problems.push(
      `${file} and ${twin}: the code differs; only comments may be translated`,
    )
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} problem(s) in the documentation`)
  process.exit(1)
}
console.log(`Documentation: ${files.length} files, links and translations ok`)
