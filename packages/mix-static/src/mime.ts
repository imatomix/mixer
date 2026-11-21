// To avoid a dependency, only the types commonly served on the web are built in
const TYPES: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  webmanifest: 'application/manifest+json',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  zip: 'application/zip',
}

const UTF8_TYPES = new Set([
  'application/json',
  'application/manifest+json',
  'application/xml',
  'image/svg+xml',
])

export function contentTypeOf(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  const type = fileName.includes('.') ? TYPES[extension] : undefined
  if (!type) return 'application/octet-stream'
  return type.startsWith('text/') || UTF8_TYPES.has(type)
    ? `${type}; charset=utf-8`
    : type
}
