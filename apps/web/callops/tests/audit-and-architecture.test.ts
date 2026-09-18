import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { completeScenario, createHarness } from './helpers';

async function TypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return TypeScriptFiles(path);
      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    }),
  );
  return nested.flat();
}

describe('audit export and architecture boundaries', () => {
  it('exports a sanitized audit without secret-shaped values', async () => {
    const { service, repository } = createHarness();
    const completed = await completeScenario(service, 'NOMINAL');
    const constructedEmail = ['demo.person', 'example.invalid'].join('@');
    const constructedPhone = ['+33', '6', '00', '00', '00', '00'].join(' ');
    const constructedUrl = ['https:', '//example.invalid', '/private'].join('');
    const constructedSecret = ['secret', 'abcdefghijklmnop'].join('_');
    const last = completed.audit.at(-1);
    if (last === undefined) throw new Error('Audit fixture missing.');
    await repository.save({
      ...completed,
      audit: [
        ...completed.audit.slice(0, -1),
        {
          ...last,
          reason: [constructedEmail, constructedPhone, constructedUrl, constructedSecret].join(' '),
        },
      ],
    });

    const exported = await service.exportSanitizedAudit();
    expect(exported).not.toContain(constructedEmail);
    expect(exported).not.toContain(constructedPhone);
    expect(exported).not.toContain(constructedUrl);
    expect(exported).not.toContain(constructedSecret);
    expect(exported).toContain('[REDACTED_EMAIL]');
    expect(exported).toContain('No real call was made.');
  });

  it('keeps the domain free of CALL-E and cache dependencies', async () => {
    const domainRoot = resolve(process.cwd(), 'src', 'domain');
    const files = await TypeScriptFiles(domainRoot);
    const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
    const combined = sources.join('\n').toLocaleLowerCase();

    expect(combined).not.toContain('@call-e/');
    expect(combined).not.toContain('.calle-mcp');
    expect(combined).not.toContain('calle-auth');
    expect(combined).not.toContain('calle-safe');
  });

  it('records every state transition with provider and plan fingerprint', async () => {
    const { service } = createHarness();
    const result = await completeScenario(service, 'NOMINAL');

    expect(result.audit.map((entry) => entry.newState)).toEqual([
      'DRAFT',
      'WAITING_FOR_APPROVAL',
      'APPROVED',
      'QUEUED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);
    expect(result.audit.slice(1).every((entry) => entry.planFingerprint !== null)).toBe(true);
    expect(result.audit.every((entry) => entry.providerType === 'MOCK')).toBe(true);
  });
});
