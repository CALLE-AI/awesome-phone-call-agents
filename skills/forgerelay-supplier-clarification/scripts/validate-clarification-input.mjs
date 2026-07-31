#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import process from "node:process";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: node validate-clarification-input.mjs <input.json>");
  process.exit(2);
}

const errors = [];
let input;

try {
  input = JSON.parse(await readFile(inputPath, "utf8"));
} catch (error) {
  console.error(`Invalid JSON input: ${error.message}`);
  process.exit(2);
}

for (const field of [
  "requestId",
  "supplierLabel",
  "phoneNumber",
  "outreachBasis",
  "callerIdentity",
  "resultTarget",
]) {
  if (typeof input[field] !== "string" || input[field].trim() === "") {
    errors.push(`${field} must be a non-empty string`);
  }
}

if (
  typeof input.phoneNumber === "string" &&
  !/^\+[1-9]\d{7,14}$/.test(input.phoneNumber)
) {
  errors.push("phoneNumber must use E.164 format");
}

if (!Array.isArray(input.allowedContext) || input.allowedContext.length === 0) {
  errors.push("allowedContext must contain at least one approved fact");
} else if (
  input.allowedContext.some(
    (item) => typeof item !== "string" || item.trim() === "",
  )
) {
  errors.push("allowedContext entries must be non-empty strings");
}

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

    if (typeof question?.prompt !== "string" || question.prompt.trim() === "") {
      errors.push(`${prefix}.prompt must be a non-empty string`);
    }

    if (typeof question?.required !== "boolean") {
      errors.push(`${prefix}.required must be boolean`);
    }
  });
}

if (errors.length > 0) {
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
}

const questionIds = input.questions.map((question) => question.id);
const idempotencyKey = createHash("sha256")
  .update(
    JSON.stringify([
      input.requestId,
      input.phoneNumber,
      questionIds,
    ]),
  )
  .digest("hex")
  .slice(0, 24);

const maskPhone = (phoneNumber) => {
  const visiblePrefix = phoneNumber.slice(0, 2);
  const visibleSuffix = phoneNumber.slice(-4);
  return `${visiblePrefix}${"*".repeat(
    Math.max(4, phoneNumber.length - visiblePrefix.length - visibleSuffix.length),
  )}${visibleSuffix}`;
};

console.log(
  JSON.stringify(
    {
      status: "dry-run",
      requestId: input.requestId,
      supplierLabel: input.supplierLabel,
      maskedPhoneNumber: maskPhone(input.phoneNumber),
      callerIdentity: input.callerIdentity,
      questionIds,
      allowedContext: input.allowedContext,
      resultTarget: input.resultTarget,
      idempotencyKey,
      realCallPlaced: false,
    },
    null,
    2,
  ),
);
