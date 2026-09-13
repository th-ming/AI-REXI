import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    host: true,  // Allow network access
    port: 5173,
    historyApiFallback: true,
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**']
    },
    hmr: {
      overlay: false
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
