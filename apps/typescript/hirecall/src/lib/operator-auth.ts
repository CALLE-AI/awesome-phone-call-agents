function bearerToken(header: string | null): string {
  const value = header?.trim() ?? "";
  if (!value.toLowerCase().startsWith("bearer ")) return "";
  return value.slice(7).trim();
}

function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

export async function operatorTokenAccepted(authorization: string | null): Promise<boolean> {
  const expected = process.env.HIRECALL_OPERATOR_TOKEN?.trim() ?? "";
  if (!expected) return false;
  const provided = bearerToken(authorization);
  const [left, right] = await Promise.all([sha256(provided), sha256(expected)]);
  return timingSafeEqualBytes(left, right);
}
