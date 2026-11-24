import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Component } from '@imatomix/mixer'

import { cacheControl, sendFile } from './send-file.js'

export interface FileOptions {
  /** max-age of Cache-Control, in seconds */
  maxAge?: number
  /**
   * Add `immutable` to Cache-Control, for files whose content never changes under the same name (such as
   * fingerprinted build output). Requires a maxAge
   */
  immutable?: boolean
}

/**
 * A Component that always returns the given file. It does not check the path, so combine it with
 * mix-router or similar, as in `get('/favicon.ico', serveFile('./favicon.ico'))`
 */
export function serveFile(
  filePath: string,
  options: FileOptions = {},
): Component {
  const realFilePath = realpathSync(resolve(filePath))
  if (!statSync(realFilePath).isFile()) {
    throw new Error(`mix-static: not a regular file: ${filePath}`)
  }
  const maxAge = options.maxAge ?? 0
  const cache = cacheControl(maxAge, options.immutable ?? false)

  return (ctx) => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return undefined
    return sendFile(ctx, realFilePath, { cacheControl: cache })
  }
}
