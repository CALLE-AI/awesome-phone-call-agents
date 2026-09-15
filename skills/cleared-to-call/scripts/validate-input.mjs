#!/usr/bin/env node
// Check that an account batch has the shape the gate needs, before any of it is
// evaluated. A row that fails here is never dialled: it is reported and skipped.
//
//   node scripts/validate-input.mjs --file accounts.json
//   node scripts/validate-input.mjs --account-json '{"account_id":"A-1001", ...}'
//
// Exit code 0 means every row is usable, 2 means at least one row is not.

import { maskPhone, parseArgs, readAccountArgument, validateAccount } from "./gate-core.mjs";

function main() {
  const args = parseArgs(process.argv.slice(2));

  let input;
  try {
    input = readAccountArgument(args);
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 1;
  }

  const rows = Array.isArray(input) ? input : [input];
  const report = rows.map((row, index) => ({
    index,
    account_id: row?.account_id ?? null,
    phone_masked: maskPhone(row?.phone_e164 ?? ""),
    usable: validateAccount(row).length === 0,
    problems: validateAccount(row),
  }));

  const unusable = report.filter((row) => !row.usable);
  console.log(
    JSON.stringify(
      {
        rows: report.length,
        usable: report.length - unusable.length,
        unusable: unusable.length,
        report,
      },
      null,
      2,
    ),
  );
  return unusable.length === 0 ? 0 : 2;
}

process.exitCode = main();
