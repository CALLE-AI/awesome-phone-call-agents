#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import process from "node:process";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: node validate-clarification-input.mjs <input.json>");
  process.exit(2);
}

const blocked = (errors) => {
  console.error(
    JSON.stringify(
      {
        status: "blocked",
        errors,
        realCallPlaced: false,
      },
      null,
      2,
    ),
  );
  process.exit(1);
};

let input;

try {
  input = JSON.parse(await readFile(inputPath, "utf8"));
} catch (error) {
  blocked([`input must be valid JSON: ${error.message}`]);
}

if (input === null || typeof input !== "object" || Array.isArray(input)) {
  blocked(["input must be one JSON object"]);
}

const errors = [];
const nonEmptyString = (value) =>
  typeof value === "string" && value.trim() !== "";

for (const field of [
  "requestId",
  "supplierLabel",
  "phoneNumber",
  "callerIdentity",
  "resultTarget",
]) {
  if (!nonEmptyString(input[field])) {
    errors.push(`${field} must be a non-empty string`);
  }
}

if (
  typeof input.phoneNumber === "string" &&
  !/^\+[1-9]\d{7,14}$/.test(input.phoneNumber)
) {
  errors.push("phoneNumber must use E.164 format");
}

const outreachBasisTypes = new Set([
  "explicit-recipient-consent",
  "existing-supplier-relationship",
  "inbound-follow-up-request",
]);

if (
  input.outreachBasis === null ||
  typeof input.outreachBasis !== "object" ||
  Array.isArray(input.outreachBasis)
) {
  errors.push("outreachBasis must be a structured object");
} else {
  if (!outreachBasisTypes.has(input.outreachBasis.type)) {
    errors.push(
      "outreachBasis.type must be explicit-recipient-consent, existing-supplier-relationship, or inbound-follow-up-request",
    );
  }
  if (!nonEmptyString(input.outreachBasis.reference)) {
    errors.push(
      "outreachBasis.reference must identify recipient-specific evidence",
    );
  }
}

if (!Array.isArray(input.allowedContext) || input.allowedContext.length === 0) {
  errors.push("allowedContext must contain at least one approved fact");
} else if (input.allowedContext.some((item) => !nonEmptyString(item))) {
  errors.push("allowedContext entries must be non-empty strings");
}

const questionCategories = new Set([
  "material-specification",
  "drawing-revision",
  "quantity",
  "manufacturing-process",
  "inspection-requirement",
  "delivery-statement",
  "quote-statement",
  "other-factual",
]);

if (
  !Array.isArray(input.questions) ||
  input.questions.length < 1 ||
  input.questions.length > 8
) {
  errors.push("questions must contain between one and eight entries");
} else {
  const seenIds = new Set();

  input.questions.forEach((question, index) => {
    const prefix = `questions[${index}]`;

    if (
      typeof question?.id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(question.id)
    ) {
      errors.push(`${prefix}.id must be a lowercase kebab-case identifier`);
    } else if (seenIds.has(question.id)) {
      errors.push(`${prefix}.id must be unique`);
    } else {
      seenIds.add(question.id);
    }

    if (!questionCategories.has(question?.category)) {
      errors.push(`${prefix}.category must be an allowed factual category`);
    }

    if (!nonEmptyString(question?.prompt)) {
      errors.push(`${prefix}.prompt must be a non-empty string`);
    }

    if (typeof question?.required !== "boolean") {
      errors.push(`${prefix}.required must be boolean`);
    }
  });
}

const commercialActionPattern =
  /\b(agree|accept|authorize|approve|award|buy|cancel|commit|guarantee|negotiate|order|pay|purchase|release|select|sign)\b.{0,80}\b(capacity|contract|delivery|liability|order|payment|price|production|quote|supplier|terms?|warranty)\b|\b(capacity|contract|delivery|liability|order|payment|price|production|quote|supplier|terms?|warranty)\b.{0,80}\b(agree|accept|authorize|approve|award|buy|cancel|commit|guarantee|negotiate|order|pay|purchase|release|select|sign)\b/i;

if (
  Array.isArray(input.questions) &&
  input.questions.some(
    (question) =>
      typeof question?.prompt === "string" &&
      commercialActionPattern.test(question.prompt),
  )
) {
  errors.push(
    "questions must not request negotiation, approval, purchase, or commercial commitments",
  );
}

let resolvedResultTarget;
if (nonEmptyString(input.resultTarget)) {
  if (
    /^(?:[a-z]+:)?\/\//i.test(input.resultTarget) ||
    input.resultTarget.includes("\0") ||
    !/\.csv$/i.test(input.resultTarget)
  ) {
    errors.push("resultTarget must be a local .csv path");
  } else {
    resolvedResultTarget = resolve(process.cwd(), input.resultTarget);
    try {
      await access(dirname(resolvedResultTarget), fsConstants.W_OK);
    } catch {
      errors.push("resultTarget parent directory must exist and be writable");
    }

    try {
      await lstat(resolvedResultTarget);
      errors.push("resultTarget must be a new path and must not already exist");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        errors.push("resultTarget could not be checked safely");
      }
    }
  }
}

if (errors.length > 0) {
  blocked(errors);
}

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const safetyContract = canonicalize({
  requestId: input.requestId,
  supplierLabel: input.supplierLabel,
  phoneNumber: input.phoneNumber,
  outreachBasis: input.outreachBasis,
  callerIdentity: input.callerIdentity,
  questions: input.questions,
  allowedContext: input.allowedContext,
  resultTarget: input.resultTarget,
  language: input.language ?? null,
  region: input.region ?? null,
  deadline: input.deadline ?? null,
});

const contractJson = JSON.stringify(safetyContract);
const safetyReviewHash = createHash("sha256").update(contractJson).digest("hex");
const idempotencyKey = createHash("sha256")
  .update(`forgerelay-supplier-clarification:v2:${contractJson}`)
  .digest("hex")
  .slice(0, 24);

const maskPhone = (phoneNumber) => {
  const visiblePrefix = phoneNumber.slice(0, 2);
  const visibleSuffix = phoneNumber.slice(-4);
  return `${visiblePrefix}${"*".repeat(
    Math.max(4, phoneNumber.length - visiblePrefix.length - visibleSuffix.length),
  )}${visibleSuffix}`;
};

const preview = {
  requestId: input.requestId,
  supplierLabel: input.supplierLabel,
  maskedPhoneNumber: maskPhone(input.phoneNumber),
  outreachBasis: input.outreachBasis,
  callerIdentity: input.callerIdentity,
  questions: input.questions,
  allowedContext: input.allowedContext,
  resultTarget: resolvedResultTarget,
  language: input.language ?? null,
  region: input.region ?? null,
  deadline: input.deadline ?? null,
  forbiddenActions: [
    "negotiate or accept commercial terms",
    "approve a supplier, quote, order, deviation, or production release",
    "disclose facts outside allowedContext",
    "place more than one call without a new approval",
  ],
  idempotencyKey,
  safetyReviewHash,
  realCallPlaced: false,
};

const approvedReview =
  input.safetyReview?.status === "approved" &&
  nonEmptyString(input.safetyReview?.reviewedBy) &&
  input.safetyReview?.contentHash === safetyReviewHash;

if (!approvedReview) {
  console.log(
    JSON.stringify(
      {
        status: "pending-safety-review",
        blocker:
          "A human or authorized agent must review the exact free text and bind approval to safetyReviewHash.",
        ...preview,
      },
      null,
      2,
    ),
  );
  process.exit(3);
}

console.log(
  JSON.stringify(
    {
      status: "dry-run",
      safetyReview: {
        status: "approved",
        reviewedBy: input.safetyReview.reviewedBy,
        contentHash: safetyReviewHash,
      },
      ...preview,
    },
    null,
    2,
  ),
);
