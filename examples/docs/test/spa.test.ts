import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/spa.ts'

/** A build output like Vite's: index.html, fingerprinted assets, and files copied from public/ */
function buildOutput(): string {
  const dist = mkdtempSync(join(tmpdir(), 'mixer-spa-'))
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><div id="root"></div>',
  )
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'assets', 'app.3f9a1c.js'), 'console.log(1)')
  writeFileSync(join(dist, 'logo.svg'), '<svg></svg>')
  return dist
}

const app = createApp(buildOutput())
const page = { accept: 'text/html,application/xhtml+xml' }
const send = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://localhost${path}`, init))

describe('the single-page app example', () => {
  it('answers / and the React app’s own URLs with index.html', async () => {
    for (const path of ['/', '/todos/3', '/settings/profile']) {
      const res = await send(path, { headers: page })
      expect(res.status, path).toBe(200)
      expect(await res.text(), path).toContain('<div id="root">')
    }
  })

  it('serves built files, with long caching for fingerprinted assets', async () => {
    const script = await send('/assets/app.3f9a1c.js')
    expect(script.headers.get('content-type')).toMatch(/javascript/)
    expect(script.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect((await send('/logo.svg')).status).toBe(200)
  })

  it('answers the API with JSON, and an unknown API path with a JSON 404, never the page', async () => {
    expect(await (await send('/api/hello')).json()).toEqual({
      message: 'Hello from mixer',
    })
    const missing = await send('/api/helo', { headers: page })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'Not Found' })
  })

  it('answers a missing file with 404 instead of the page', async () => {
    const res = await send('/assets/old.js', { headers: { accept: '*/*' } })
    expect(res.status).toBe(404)
  })

  it('refuses a cross-site form post to the API', async () => {
    const res = await send('/api/hello', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(res.status).toBe(403)
  })
})
