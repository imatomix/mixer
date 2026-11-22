import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  sourcemap: true,
})
