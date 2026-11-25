import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // While developing, mixer answers the API: start it with `pnpm start` and the frontend with `pnpm dev:web`.
  // serve() listens on 127.0.0.1, and `localhost` can resolve to ::1 first, so the address is written out
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
})
