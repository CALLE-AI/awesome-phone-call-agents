/**
 * Render a payload to lines, each one carrying the path it lives at.
 *
 * The point of the split screen is that a reading and the field it came from
 * are on screen together. That only works if the page can find the field, and
 * `JSON.stringify(value, null, 2)` gives back a string with no way to ask
 * which line is `recipients[0].attempts[0].failure_code`.
 *
 * So the payload is rendered here instead, and every line remembers where it
 * came from, in the same notation the mappers use in `AxisReading.from`.
 */

export interface JsonLine {
  indent: number;
  text: string;
  /** Dotted and bracketed path, or null for a structural line like a closing brace. */
  path: string | null;
}

function child(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}

function literal(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function render(
  value: unknown,
  path: string,
  indent: number,
  label: string | null,
  trailingComma: boolean,
  out: JsonLine[],
): void {
  const prefix = label === null ? "" : `${JSON.stringify(label)}: `;
  const comma = trailingComma ? "," : "";

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ indent, text: `${prefix}[]${comma}`, path });
      return;
    }
    out.push({ indent, text: `${prefix}[`, path });
    value.forEach((item, index) => {
      render(item, `${path}[${index}]`, indent + 1, null, index < value.length - 1, out);
    });
    out.push({ indent, text: `]${comma}`, path: null });
    return;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.push({ indent, text: `${prefix}{}${comma}`, path });
      return;
    }
    out.push({ indent, text: `${prefix}{`, path });
    keys.forEach((key, index) => {
      render(
        value[key],
        child(path, key),
        indent + 1,
        key,
        index < keys.length - 1,
        out,
      );
    });
    out.push({ indent, text: `}${comma}`, path: null });
    return;
  }

  out.push({ indent, text: `${prefix}${literal(value)}${comma}`, path });
}

export function toJsonLines(payload: unknown): JsonLine[] {
  const out: JsonLine[] = [];
  render(payload, "", 0, null, false, out);
  return out;
}

/**
 * Does this line sit at, or inside, one of the paths a reading cited?
 *
 * Citing `structured_result` should light up the whole object, not just the
 * brace it opens on, so an ancestor match counts.
 */
export function isCited(line: JsonLine, cited: readonly string[]): boolean {
  if (line.path === null) return false;
  return cited.some(
    (from) =>
      line.path === from ||
      line.path!.startsWith(`${from}.`) ||
      line.path!.startsWith(`${from}[`),
  );
}
