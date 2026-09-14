import { chownSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Railway mounts volumes as root. Initialize only this app's database paths,
// then permanently drop privileges before loading any application code.
if (process.getuid?.() === 0) {
  const database = resolve(process.env.DATABASE_PATH || '/app/data/readycheck.sqlite');
  const directory = dirname(database);
  if (directory !== '/app/data') throw new Error('Container database must be in /app/data.');
  mkdirSync(directory, { recursive: true });
  for (const path of [directory, database, `${database}-wal`, `${database}-shm`]) {
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if (error.code === 'ENOENT' && path !== directory) continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('Database paths cannot be symbolic links.');
    chownSync(path, 1000, 1000);
  }
  process.setgroups([]);
  process.setgid(1000);
  process.setuid(1000);
}

await import('../server/index.ts');
