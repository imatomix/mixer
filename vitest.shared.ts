import { defineConfig } from 'vitest/config'

// Inside the monorepo, resolve workspace packages from src instead of dist so that tests run without a build
const conditions = ['@imatomix/source', 'import', 'module', 'node', 'default']

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
})
