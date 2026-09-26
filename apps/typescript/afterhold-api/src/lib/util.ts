import { nanoid } from 'nanoid';
import crypto from 'node:crypto';

export const newId = (prefix: string) => `${prefix}_${nanoid(16)}`;

export const now = () => Date.now();

export const hashKey = (...parts: (string | number)[]) =>
  crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);

export const redactE164 = (e164: string) => e164.replace(/(\+\d{1,3})(\d+)(\d{4})/, (_m, cc, mid, last) =>
  `${cc}${'*'.repeat(Math.max(mid.length, 4))}${last}`,
);

export const isE164 = (s: string) => /^\+[1-9]\d{7,14}$/.test(s);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const isoToMs = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
