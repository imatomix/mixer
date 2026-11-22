import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts', 'src/redis.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  sourcemap: true,
})
