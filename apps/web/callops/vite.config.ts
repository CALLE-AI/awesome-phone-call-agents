import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'local-demo-content-policy',
    apply: 'build',
    transformIndexHtml: () => [{
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'",
      },
      injectTo: 'head-prepend',
    }],
  }],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: { workshop: 'index.html', replay: 'replay.html' } },
  },
});
