import { defineConfig } from 'vitest/config'

// monorepo 内では依存パッケージを dist ではなく src から解決し、ビルドなしでテストできるようにする
const conditions = ['@imatomix/source', 'import', 'module', 'node', 'default']

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
})
