import { inflateRawSync } from 'node:zlib';

/**
 * Reading a spreadsheet a person exported, without taking a dependency to do it.
 *
 * The obvious libraries were both wrong here. SheetJS on npm is pinned at
 * 0.18.5 -- the release with the prototype-pollution and ReDoS advisories,
 * because the maintained builds moved to the author's own CDN -- and exceljs
 * unpacks to 21 MB for what amounts to reading two XML files out of a zip.
 *
 * An .xlsx IS a zip of XML. Node can already inflate; the rest is the central
 * directory and enough of SpreadsheetML to find cell values. That is a bounded
 * amount of code with no supply chain attached, and it lets every limit here
 * be chosen deliberately rather than inherited.
 *
 * What this does NOT do, on purpose: formulas, styles, dates as serial
 * numbers, multiple sheets, or anything but the first worksheet. A contact
 * list is names and phone numbers.
 */

/** Refuses anything larger before allocating for it. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** A single entry that inflates beyond this is a zip bomb, not a contact list. */
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
/** More rows than any business is pasting in by hand. */
export const MAX_SPREADSHEET_ROWS = 5000;

export class SpreadsheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpreadsheetError';
  }
}

export interface SpreadsheetTable {
  /** The first row, lower-cased and trimmed, when it looks like a header. */
  headers: string[];
  /** Every row after the header, as raw cell strings. */
  rows: string[][];
}

/* ----------------------------------------------------------------- zip --- */

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Reads the entries a spreadsheet needs out of a zip.
 *
 * Walks the central directory backwards from the End Of Central Directory
 * record, which is how a zip is meant to be read: the local headers can lie
 * about sizes, the central directory is authoritative.
 */
function readZip(buffer: Buffer, wanted: (name: string) => boolean): ZipEntry[] {
  // The EOCD record is at the end, after a comment of unknown length.
  let eocd = -1;
  const earliest = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= earliest; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x0605_4b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SpreadsheetError('That file is not a spreadsheet Dial can read.');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > buffer.length) break;
    if (buffer.readUInt32LE(offset) !== 0x0201_4b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    offset += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;

    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new SpreadsheetError('That spreadsheet is too large for Dial to read.');
    }

    // The local header's own name and extra fields sit before the data, and
    // its extra length can differ from the central one.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);

    try {
      entries.push({ name, data: method === 0 ? raw : inflateRawSync(raw) });
    } catch {
      throw new SpreadsheetError('That spreadsheet could not be opened.');
    }
  }

  return entries;
}

/* ------------------------------------------------------------- xlsx xml --- */

/** Unescapes the five XML entities SpreadsheetML actually uses. */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    // Ampersand last, or the replacements above would be re-escaped.
    .replace(/&amp;/g, '&');
}

/**
 * The shared string table. Excel stores repeated text once and refers to it by
 * index, so most cells in a real export are pointers into this.
 */
function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    // A single string may be split across runs (<r><t>..</t></r>) when part of
    // it is styled differently. Joining every <t> recovers the whole value.
    const parts = [...(match[1] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? '');
    strings.push(unescapeXml(parts.join('')));
  }
  return strings;
}

/** 'BC7' -> 54. Column letters are base-26 with no zero. */
function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference)?.[1] ?? 'A';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function readSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];

    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const type = /t="([^"]+)"/.exec(attributes)?.[1];

      let value: string;
      if (type === 's') {
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
        value = shared[index] ?? '';
      } else if (type === 'inlineStr') {
        const parts = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? '');
        value = unescapeXml(parts.join(''));
      } else {
        value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }

      // Honour the cell reference: Excel omits empty cells entirely, so
      // pushing in document order would shift every later column left.
      const at = reference ? columnIndex(reference) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value.trim();
    }

    rows.push(cells);
    if (rows.length > MAX_SPREADSHEET_ROWS + 1) {
      throw new SpreadsheetError(
        `That spreadsheet has more than ${MAX_SPREADSHEET_ROWS} rows. Split it and import in parts.`,
      );
    }
  }

  return rows;
}

/* ------------------------------------------------------------------ csv --- */

/**
 * A CSV reader that understands quotes, because a name like
 * "Ahmed, Sons & Co" is exactly the case a naive split breaks on.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // A byte-order mark from Excel would otherwise become part of the first
  // header, so "Name" never matches.
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === ';' || char === '\t') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_SPREADSHEET_ROWS + 1) {
        throw new SpreadsheetError(
          `That file has more than ${MAX_SPREADSHEET_ROWS} rows. Split it and import in parts.`,
        );
      }
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell !== ''));
}

/* ---------------------------------------------------------------- entry --- */

/**
 * Reads an .xlsx or a .csv into a header row and data rows.
 *
 * Both are offered because "export to CSV" is one menu item away in every
 * spreadsheet program, and a person whose file this cannot open deserves a
 * route that works rather than an apology.
 */
export function parseSpreadsheet(file: Buffer, filename: string): SpreadsheetTable {
  if (file.length === 0) throw new SpreadsheetError('That file is empty.');
  if (file.length > MAX_FILE_BYTES) {
    throw new SpreadsheetError('That file is larger than 5 MB. Split it and import in parts.');
  }

  const isZip = file.length > 4 && file.readUInt32LE(0) === 0x0403_4b50;
  let rows: string[][];

  if (isZip) {
    const entries = readZip(
      file,
      (name) => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
    );

    const sharedEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
    const shared = sharedEntry ? readSharedStrings(sharedEntry.data.toString('utf8')) : [];

    // The first worksheet by number, not by whatever order the zip stored them.
    const sheets = entries
      .filter((e) => e.name !== 'xl/sharedStrings.xml')
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    if (!sheets[0]) throw new SpreadsheetError('That spreadsheet has no sheets Dial could read.');

    rows = readSheet(sheets[0].data.toString('utf8'), shared).filter((r) =>
      r.some((cell) => cell !== ''),
    );
  } else if (/\.xls$/i.test(filename)) {
    // The old binary format is a different thing entirely, and worth naming
    // rather than failing as "not a spreadsheet".
    throw new SpreadsheetError(
      'That is the older .xls format. Open it and use Save As to make an .xlsx or a .csv.',
    );
  } else {
    rows = parseCsv(file.toString('utf8'));
  }

  if (rows.length === 0) throw new SpreadsheetError('There are no rows in that file.');

  const [first, ...rest] = rows;
  return { headers: (first ?? []).map((h) => h.trim().toLowerCase()), rows: rest };
}
