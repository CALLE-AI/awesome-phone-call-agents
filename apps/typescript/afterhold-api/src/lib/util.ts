import { nanoid } from 'nanoid';
import crypto from 'node:crypto';

export const newId = (prefix: string) => `${prefix}_${nanoid(16)}`;

export const now = () => Date.now();

export const hashKey = (...parts: (string | number)[]) =>
  crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);

export const redactE164 = (e164: string) => e164.replace(/(\+\d{1,3})(\d+)(\d{4})/, (_m, cc, mid, last) =>
  `${cc}${'*'.repeat(Math.max(mid.length, 4))}${last}`,
);

// A run of 7+ digits, optionally with a leading + and spaces, dots, dashes or
// parentheses between them. Matches phone numbers in free text (goals,
// transcripts, briefs, error bodies).
const PHONE_LIKE = /\+?\d[\d\s().-]{5,}\d/g;

/** Mask every phone-like digit run in free text, keeping only the last 4 digits. */
export const maskPhones = (text: string) =>
  text.replace(PHONE_LIKE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 7) return m;
    if (/^\d{4}[-.]\d{2}[-.]\d{2}$/.test(m)) return m; // ISO-style date, not a phone
    return `${m.startsWith('+') ? '+' : ''}${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
  });

/** Recursively mask phone-like strings inside any JSON-shaped value. */
export const maskDeep = <T>(value: T): T => {
  if (typeof value === 'string') return maskPhones(value) as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)])) as T;
  }
  return value;
};

export const isE164 = (s: string) => /^\+[1-9]\d{7,14}$/.test(s);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const isoToMs = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
