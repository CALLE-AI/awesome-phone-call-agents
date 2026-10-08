// Product URL -> RequestedSpec fields.
//
// Two deterministic sources, no network fetch:
//   1. the fixtures/products.json catalog stub (stands in for a real
//      catalog integration, which is deliberately not built), matched by
//      URL substring;
//   2. tokens parsed straight out of the URL slug as a fallback.
// Email-derived fields win over both: what the customer wrote is the ask.

import { readFileSync } from 'node:fs';
import type { EmailIntake } from './parseEmail.js';
import type { RequestedSpec } from '../types.js';

interface CatalogEntry {
  urlContains: string;
  family: string;
  cpu?: string;
  gpu?: string;
  ramGb?: number;
  storageGb?: number;
  panel?: string;
}

export function parseProduct(
  rfqId: string,
  intake: EmailIntake,
  catalogPath: string,
): RequestedSpec {
  const url = intake.sourceUrl ?? '';
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { products: CatalogEntry[] };
  const hit = catalog.products.find((p) => url.includes(p.urlContains));

  const slugFamily = url
    ? decodeURIComponent(url.split('/').filter(Boolean).pop() ?? '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b(ph|nh)\d{2,}.*$/i, '')
        .trim()
    : '';

  const family = hit?.family ?? slugFamily;
  if (!family) {
    throw new Error(
      'Could not resolve a product family from the email or URL. Refusing to guess: add the product to fixtures/products.json or state the model in the email.',
    );
  }

  return {
    rfqId,
    family,
    // cpu enters the ask only when the CUSTOMER stated it. The catalog's cpu
    // is informational: the call script verifies gpu/ram/storage, so a
    // catalog-injected cpu would make every quote unverifiable.
    cpu: intake.cpu,
    gpu: intake.gpu ?? hit?.gpu,
    ramGb: intake.ramGb ?? hit?.ramGb,
    storageGb: intake.storageGb ?? hit?.storageGb,
    panel: hit?.panel,
    quantity: intake.quantity ?? 1,
    neededBy: intake.neededBy,
    sourceUrl: intake.sourceUrl,
    rawEmail: intake.rawEmail,
  };
}
