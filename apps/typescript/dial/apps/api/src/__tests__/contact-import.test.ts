import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { businessContacts, contacts } from '@dial/database';
import { createHarness, signUp, type Harness } from './harness.js';

/**
 * Importing a business's customer list from a spreadsheet.
 *
 * The line that matters most here is the one between a business's customers
 * and the user's own address book. They are different people, gathered under
 * different consent, and an import that blurred them would put a company's
 * customer list into a personal contacts screen.
 */

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function setupBusiness(token: string, country = 'AE') {
  const response = await h!.app.inject({
    method: 'POST',
    url: '/api/businesses',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Acme Dental', industry: 'healthcare', timezone: 'Asia/Dubai', country },
  });
  return (response.json() as { id: string }).id;
}

function csv(text: string) {
  return { filename: 'customers.csv', contentBase64: Buffer.from(text, 'utf8').toString('base64') };
}

async function importFile(
  token: string,
  businessId: string,
  file: { filename: string; contentBase64: string },
  dryRun = false,
) {
  const response = await h!.app.inject({
    method: 'POST',
    url: `/api/businesses/${businessId}/contacts/import`,
    headers: { authorization: `Bearer ${token}` },
    payload: { ...file, dryRun },
  });
  return { status: response.statusCode, body: response.json() as ImportBody };
}

interface ImportBody {
  columns: { name: string | null; phone: string | null; email: string | null; reference: string | null };
  imported: number;
  duplicates: number;
  skipped: Array<{ row: number; name: string | null; phone: string | null; reason: string }>;
  totalRows: number;
  dryRun: boolean;
  sample: Array<{ name: string; phoneE164: string }>;
  error?: { code: string; message: string };
}

describe('importing a customer list', () => {
  it('writes to the business, and never to the user’s own contacts', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const businessId = await setupBusiness(user.token);

    const { status, body } = await importFile(
      user.token,
      businessId,
      csv('Name,Phone\nSarah Ahmed,055 123 4567\nOmar Ali,+971 4 555 0000\n'),
    );

    expect(status).toBe(200);
    expect(body.imported).toBe(2);

    const forBusiness = await h.handle.db
      .select()
      .from(businessContacts)
      .where(eq(businessContacts.businessId, businessId));
    expect(forBusiness).toHaveLength(2);

    // The whole point: the user's personal address book is untouched.
    const personal = await h.handle.db
      .select()
      .from(contacts)
      .where(eq(contacts.userId, user.userId));
    expect(personal).toHaveLength(0);
  });

  it('reads local numbers using the business’s own country', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const businessId = await setupBusiness(user.token, 'AE');

    const { body } = await importFile(user.token, businessId, csv('Name,Phone\nSarah,055 123 4567\n'));
    // "055 123 4567" only means something once you know where the business is.
    expect(body.sample[0]?.phoneE164).toBe('+971551234567');
  });

  it('reads a real .xlsx, not only CSV', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const businessId = await setupBusiness(user.token);

    const { status, body } = await importFile(user.token, businessId, {
      filename: 'customers.xlsx',
      contentBase64: XLSX_FIXTURE,
    });

    expect(status).toBe(200);
    expect(body.columns).toMatchObject({ name: 'name', phone: 'phone' });
    expect(body.imported).toBe(2);
    expect(body.sample.map((s) => s.name)).toEqual(['Sarah Ahmed', 'Omar Ali']);
  });

  it('says which rows it could not use, and why', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const businessId = await setupBusiness(user.token);

    const { body } = await importFile(
      user.token,
      businessId,
      csv(
        'Name,Phone\n' +
          'Good One,055 123 4567\n' +
          ',055 999 8888\n' +
          'No Number,\n' +
          'Nonsense,banana\n',
      ),
    );

    expect(body.imported).toBe(1);
    expect(body.skipped).toHaveLength(3);
    // Row numbers match what the spreadsheet shows, header included.
    expect(body.skipped.map((s) => s.row)).toEqual([3, 4, 5]);
    expect(body.skipped.map((s) => s.reason)).toEqual([
      'No name',
      'No phone number',
      expect.stringMatching(/not a phone number/i),
    ]);
  });

  it('does not add anyone twice, in the file or against the list', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const businessId = await setupBusiness(user.token);

    // Repeated inside the file itself.
    const first = await importFile(
      user.token,
      businessId,
      csv('Name,Phone\nSarah,055 123 4567\nSarah Again,055 123 4567\n'),
    );
    expect(first.body.imported).toBe(1);
    expect(first.body.duplicates).toBe(1);

    // And again on a second upload of the same list.
    const second = await importFile(user.token, businessId, csv('Name,Phone\nSarah,055 123 4567\n'));
    expect(second.body.imported).toBe(0);
    expect(second.body.duplicates).toBe(1);

    const rows = await h.handle.db
      .select()
      .from(businessContacts)
      .where(eq(businessContacts.businessId, businessId));
    expect(rows).toHaveLength(1);
  });

  it('can report what a file holds without writing any of it', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const businessId = await setupBusiness(user.token);

    const { body } = await importFile(
      user.token,
      businessId,
      csv('Name,Phone\nSarah,055 123 4567\n'),
      true,
    );

    expect(body.dryRun).toBe(true);
    expect(body.imported).toBe(0);
    expect(body.sample).toHaveLength(1);

    const rows = await h.handle.db
      .select()
      .from(businessContacts)
      .where(eq(businessContacts.businessId, businessId));
    expect(rows).toHaveLength(0);
  });

  it('asks for headings rather than guessing at unlabelled columns', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const businessId = await setupBusiness(user.token);

    const { status, body } = await importFile(
      user.token,
      businessId,
      csv('Sarah,055 123 4567\nOmar,055 222 3333\n'),
    );

    expect(status).toBe(400);
    expect(body.error?.code).toBe('missing_columns');
    expect(body.error?.message).toMatch(/Name/);
  });

  it('is nobody else’s business to import into', async () => {
    h = await createHarness({});
    const alice = await signUp(h);
    const bob = await signUp(h);
    const businessId = await setupBusiness(alice.token);

    const asBob = await importFile(bob.token, businessId, csv('Name,Phone\nX,055 123 4567\n'));
    expect(asBob.status).toBe(404);

    const anonymous = await h.app.inject({
      method: 'POST',
      url: `/api/businesses/${businessId}/contacts/import`,
      payload: { filename: 'c.csv', contentBase64: 'x' },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('names the older .xls format rather than failing vaguely', async () => {
    h = await createHarness({});
    const user = await signUp(h);
    const businessId = await setupBusiness(user.token);

    const { status, body } = await importFile(user.token, businessId, {
      filename: 'old.xls',
      contentBase64: Buffer.from('not a zip', 'utf8').toString('base64'),
    });

    expect(status).toBe(400);
    expect(body.error?.message).toMatch(/Save As/i);
  });
});

/**
 * A genuine .xlsx: a zip holding sharedStrings and one worksheet, exactly as
 * Excel writes it. Inline so the test needs no fixture file on disk.
 */
const XLSX_FIXTURE =
  'UEsDBBQAAAAIAAZ0I11ZvOmXwAAAACEBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QvXLCMAx+' +
  'FZ/XHlZgYOglYYCupUNfQHUU4ott+WxBw9vXgU4dOumk7/fUHpbg1Y1ycRw7vTWNPvTt5z1RURWJ' +
  'pdOTSHoFKHaigMVwoliRkXNAqWu+QEI744Vg1zR7sByFomxk9dB9e6IRr17U21LPz5Qq1+r45K1R' +
  'ncaUvLMoFYYVhb4911LZDaQ+MMs7hsqCxcM35/mLeTb/m9zi8KfphsfRWRrYXkOVmJIy4VAmIgne' +
  'PKYJ6OLLbz48ntD/AFBLAwQUAAAACAAGdCNdphrRMJ8AAAD5AAAADwAAAHhsL3dvcmtib29rLnht' +
  'bI2POxKDMAxEr+LRARCkSMEY06RJnRM4IGIP2GYk53P8OCT0qbTaLd6u7l9hUQ9i8Sl20FQ19EY/' +
  'E8/XlGZVwigduJzXFlEGR8FKlVaKJZkSB5vLyzeUlcmO4ohyWPBQ10cM1kcwevPkd1W0gTq4fHQD' +
  'avPOY+GC4tYXweex6A3b8j/gNE1+oFMa7oFi/pKZFpvLHnF+FUCjcS+B+zLzBlBLAwQUAAAACAAG' +
  'dCNdY0/M3rsAAAA/AQAAFAAAAHhsL3NoYXJlZFN0cmluZ3MueG1sZZDRagIxEEV/ZcirsMlaV6tk' +
  'Y6X0VQv9grCOTWAn2Wayxc9vRERI5+2eA/fC6P2VRvjFxD6GXrSNEnujmTMUHrgXLudpJyUPDsly' +
  'EycMxVxiIptLTN+Sp4T2zA4x0yiXSq0lWR8EDHEOuRevAubgf2Z8f+Qy4I3O5mgJtcxGy1u+s08X' +
  'wz/4UQrHGn7ZZB0cHOG5VqrroF2+wKpbb2rHb9dmiFTjE9kEh9HXfLHdtLCCrjSqck8ty5PMH1BL' +
  'AwQUAAAACAAGdCNdkF01jLAAAACYAQAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbG2QbQ7C' +
  'IAyGr0I4wMo2nYlhLH5chEx0iwMWIJvHFxdDKvFf26ftk7y8e+mJLMr50ZqWlgWjneCrdU8/KBVI' +
  'pMa3dAhhPgL4flBa+sLOykRyt07LEFv3AD87JW/bkZ6gYqwBLUdDBd9mVxmk4M6uxEVLnPaf4lRS' +
  'ElrqY78IxmERHPovO2NW/rILZlViEP8nSZUkFVquMwlmu0yC2f6/pE6SGi03mQSzQ/YIUDyQchdv' +
  'UEsBAhQAFAAAAAgABnQjXVm86ZfAAAAAIQEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5' +
  'cGVzXS54bWxQSwECFAAUAAAACAAGdCNdphrRMJ8AAAD5AAAADwAAAAAAAAAAAAAAgAHxAAAAeGwv' +
  'd29ya2Jvb2sueG1sUEsBAhQAFAAAAAgABnQjXWNPzN67AAAAPwEAABQAAAAAAAAAAAAAAIABvQEA' +
  'AHhsL3NoYXJlZFN0cmluZ3MueG1sUEsBAhQAFAAAAAgABnQjXZBdNYywAAAAmAEAABgAAAAAAAAA' +
  'AAAAAIABqgIAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLBQYAAAAABAAEAAYBAACQAwAAAAA=';
