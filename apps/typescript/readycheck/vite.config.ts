import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { hmr: { port: 24679 } },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react') || id.includes('/node_modules/scheduler/'))
            return 'react';
          if (id.includes('/node_modules/@js-temporal/') || id.includes('/node_modules/jsbi/'))
            return 'time';
          if (id.includes('/node_modules/zod/')) return 'validation';
        },
      },
    },
  },
});
