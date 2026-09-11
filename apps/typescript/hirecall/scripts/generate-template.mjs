import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { utils, write } from "xlsx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "samples");
const outFile = join(outDir, "candidates.sample.xlsx");

const candidateRows = [
  ["name", "phone", "job_role", "consent", "resume_link"],
  [
    "Priya Sharma",
    "+14155550123",
    "Software intern",
    "yes",
    "https://drive.google.com/file/d/example-priya/view?usp=sharing",
  ],
  [
    "Rahul Mehta",
    "+14155550124",
    "Software intern",
    "yes",
    "https://drive.google.com/file/d/example-rahul/view?usp=sharing",
  ],
  ["Anita Joseph", "+14155550125", "Software intern", "no", ""],
  ["", "", "", "", ""],
  ["", "", "", "", ""],
  ["", "", "", "", ""],
  ["", "", "", "", ""],
];

const guideRows = [
  ["column", "required", "what_to_enter", "example"],
  ["name", "yes", "Full name of the candidate", "Priya Sharma"],
  ["phone", "yes", "Mobile with country code. Example reserved number: +14155550123. Replace with a real E.164 number before live calls.", "+14155550123"],
  ["job_role", "yes", "Opening for this Excel. Use the same role on every row.", "Software intern"],
  [
    "consent",
    "no",
    "yes or no. Also accepts y, true, 1, consented, granted, ok.",
    "yes",
  ],
  [
    "resume_link",
    "no",
    "Google Drive or other URL to the resume. Leave blank if you do not have it yet.",
    "https://drive.google.com/file/d/example-priya/view?usp=sharing",
  ],
  [],
  ["How to use"],
  ["1. Keep the header row as-is: name, phone, job_role, consent, resume_link"],
  ["2. Put the job role on every row (same value is fine)"],
  ["3. Replace the example rows with your candidates"],
  ["4. Save this file and upload it on the HireCall dashboard"],
  ["5. HireCall stores only the rows. The Excel file itself is discarded"],
];

const candidates = utils.aoa_to_sheet(candidateRows);
candidates["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 64 }];

const guide = utils.aoa_to_sheet(guideRows);
guide["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 78 }, { wch: 64 }];

const workbook = utils.book_new();
utils.book_append_sheet(workbook, candidates, "Candidates");
utils.book_append_sheet(workbook, guide, "How to fill");

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, write(workbook, { type: "buffer", bookType: "xlsx" }));
console.log(`Wrote ${outFile}`);
