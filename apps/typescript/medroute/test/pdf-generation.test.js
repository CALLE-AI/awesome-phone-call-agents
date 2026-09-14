import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const python = process.env.MEDROUTE_PYTHON || "python";
const script = join(process.cwd(), "scripts", "generate-transcript-pdf.py");

test("PDF text normalization repairs mojibake and preserves Unicode", () => {
  const code = `import importlib.util,json; spec=importlib.util.spec_from_file_location("pdfgen", r"${script}"); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(json.dumps([module.normalize_text("Whatâ€™s"), module.normalize_text("+254â€¢â€¢â€¢7165"), module.normalize_text("today’s"), module.normalize_text("KES 200–300")]))`;
  const result = spawnSync(python, ["-c", code], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["What’s", "+254•••7165", "today’s", "KES 200-300"]);
});

test("PDF generator accepts UTF-8 JSON through stdin", () => {
  const payload = { pharmacy: "Karindu Pharmacy", medicine: "Panadol", phone: "+254•••••7165", transcript: [{ speaker: "bot", text: "What’s the approximate price range?" }] };
  const result = spawnSync(python, [script], { input: Buffer.from(JSON.stringify(payload), "utf8"), maxBuffer: 5_000_000 });
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  assert.equal(result.stdout.subarray(0, 5).toString("ascii"), "%PDF-");
});
