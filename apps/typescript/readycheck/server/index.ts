import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app';
if (existsSync('.env')) process.loadEnvFile('.env');
const { app, store, service } = createApp();
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*splat}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
service.recoverClaims();
const interval = setInterval(() => {
  void service.tick().catch(() => console.error('Reconciliation failed; will retry read-only.'));
}, 5000);
const server = app.listen(
  Number(process.env.PORT || 3000),
  process.env.BIND_HOST || '127.0.0.1',
  () =>
    console.log(
      `ReadyCheck is running at ${process.env.APP_ORIGIN || 'http://localhost:3000'} · sample mode available`,
    ),
);
const stop = () => {
  clearInterval(interval);
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
