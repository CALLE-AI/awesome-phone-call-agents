import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The backend (uvicorn) binds 127.0.0.1:8000. We proxy to the IPv4 loopback explicitly
// because Node 17+ may resolve "localhost" to ::1 first, which would miss the backend.
//
// `BUDDYE_API` overrides the target for the case where 8000 is already taken by something else on
// the machine — a second checkout, another project's API, a container. The default is unchanged, so
// nothing about the documented `npm run dev` workflow moves.
// Declared rather than pulled in with @types/node: this is the one Node global the config touches,
// and a whole type package for it would be the tail wagging the dog.
declare const process: { env: Record<string, string | undefined> }

const target = process.env.BUDDYE_API ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
        // SSE: keep the response streaming (no buffering / no timeout).
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Cache-Control', 'no-cache')
          })
        },
      },
    },
  },
})
