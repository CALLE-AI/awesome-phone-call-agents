import assert from "node:assert/strict";
import test from "node:test";

import {
  detectProfileImageMime,
  parseProfileDetails,
  ProfileInputError,
} from "../lib/profile";

test("profile details are trimmed and an empty company becomes null", () => {
  assert.deepEqual(parseProfileDetails("  Asha Sen  ", "   "), {
    fullName: "Asha Sen",
    companyName: null,
  });
});

test("profile details reject missing names and oversized companies", () => {
  assert.throws(
    () => parseProfileDetails("", "x".repeat(121)),
    (error: unknown) => error instanceof ProfileInputError && error.issues.length === 2,
  );
});

test("profile images are identified by bytes rather than browser-provided MIME", () => {
  assert.equal(
    detectProfileImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
  assert.equal(detectProfileImageMime(Uint8Array.from([0xff, 0xd8, 0xff])), "image/jpeg");
  assert.equal(
    detectProfileImageMime(Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])),
    "image/webp",
  );
  assert.equal(detectProfileImageMime(new TextEncoder().encode("<svg></svg>")), null);
});
