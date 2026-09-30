const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function parseAuthorizedTargets(value: string | undefined): ReadonlySet<string> {
  if (!value?.trim()) {
    throw new Error(
      "CALLSUITE_AUTHORIZED_TARGETS is missing or empty. Live and dry-run modes require an explicit authorized-target allowlist.",
    );
  }

  const targets = value
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);

  if (targets.length === 0) {
    throw new Error("CALLSUITE_AUTHORIZED_TARGETS must contain at least one E.164 target.");
  }

  for (const target of targets) {
    if (!E164_PATTERN.test(target)) {
      throw new Error(
        "An authorized-target entry is invalid. Use exact E.164 numbers only; wildcards, prefixes, and ranges are not allowed.",
      );
    }
  }

  return new Set(targets);
}

export function assertAuthorizedTarget(target: string, authorizedTargets: ReadonlySet<string>): void {
  if (!E164_PATTERN.test(target)) {
    throw new Error("CALLSUITE_TEST_PHONE must use E.164 format, such as +15550101234.");
  }

  if (!authorizedTargets.has(target)) {
    throw new Error(
      "Configured target is not present in CALLSUITE_AUTHORIZED_TARGETS. No call was placed.",
    );
  }
}
