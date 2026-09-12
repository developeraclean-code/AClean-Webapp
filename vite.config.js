import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Vite hanya menjalankan frontend. Saat dev, proxy /api ke deployment backend
  // agar Monitoring/login/upload tidak menerima index.html dan berhenti loading.
  const apiTarget = env.VITE_DEV_API_PROXY || 'https://a-clean-webapp.vercel.app'
  return {
    plugins: [react(), nodePolyfills({ include: ['buffer'] })],
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 2000,
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
          configure(proxy) {
            proxy.on('proxyReq', proxyReq => proxyReq.setHeader('Origin', apiTarget))
          },
        },
      },
    },
  }
})
