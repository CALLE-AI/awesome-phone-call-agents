export const PROFILE_IMAGE_BUCKET = "profile-images";
export const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;

export class ProfileInputError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "ProfileInputError";
  }
}

export function parseProfileDetails(fullNameValue: unknown, companyNameValue: unknown): {
  fullName: string;
  companyName: string | null;
} {
  const fullName = typeof fullNameValue === "string" ? fullNameValue.trim() : "";
  const companyName = typeof companyNameValue === "string" ? companyNameValue.trim() : "";
  const issues: string[] = [];
  if (!fullName || fullName.length > 120) {
    issues.push("Full name must contain 1 to 120 characters");
  }
  if (companyName.length > 120) {
    issues.push("Company name must not exceed 120 characters");
  }
  if (issues.length) throw new ProfileInputError(issues);
  return { fullName, companyName: companyName || null };
}

export function detectProfileImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
