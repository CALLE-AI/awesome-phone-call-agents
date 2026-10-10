import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // /wake/<token> is a real URL people open from a half-awake state, so the
    // dev server must serve index.html for it rather than 404.
    historyApiFallback: true,
  },
})
