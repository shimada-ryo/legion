import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/templates': 'http://localhost:5500',
      '/instances': 'http://localhost:5500',
      '/workflows': 'http://localhost:5500',
      '/ws': { target: 'ws://localhost:5500', ws: true },
    },
  },
})
