import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("demo availability checks return ranked structured results without CALL-E credentials", async () => {
  const port = 31415;
  const dataDir = await mkdtemp(join(tmpdir(), "medroute-test-"));
  const server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(port), CALLE_API_KEY: "", MEDROUTE_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not start")), 4_000);
    server.stdout.on("data", chunk => {
      if (chunk.toString().includes("MedRoute running")) { clearTimeout(timer); resolve(); }
    });
    server.once("error", reject);
  });
  try {
    const response = await fetch(`http://localhost:${port}/api/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        medicine: "Amoxicillin",
        strength: "500 mg capsules",
        confirmLive: false,
        pharmacies: [
          { name: "Demo One", phone: "+15550101001", distanceKm: 1 },
          { name: "Demo Two", phone: "+15550101003", distanceKm: 4 }
        ]
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.mode, "demo");
    assert.equal(payload.results.length, 2);
    assert.equal(payload.results[0].result.stock_status, "in_stock");
    assert.equal(payload.results[0].mode, "demo");

    await writeFile(join(dataDir, "medroute-history.json"), JSON.stringify([{
      id: "run_123456789",
      createdAt: "2026-07-25T09:30:00.000Z",
      mode: "live",
      medicine: "Amoxicillin",
      strength: "250 milligrams Capsule",
      results: [{
        pharmacy: "Moni Pharmacy Kitale",
        phone: "+15550101005",
        distanceKm: 1.2,
        callId: "call_demo",
        summary: "The medicine is available today.",
        transcript: [
          { speaker: "bot", offsetSeconds: 0, text: "Hello, this is an AI representative from Med Route. Is this Moni Pharmacy Kitale?" },
          { speaker: "user", offsetSeconds: 4, text: "Yes, this is Moni Pharmacy Kitale." }
        ],
        result: { stock_status: "in_stock", price_range: "KES 850", pickup_readiness: "unknown", hours: "Open until 8 PM", confidence: "high" },
        mode: "live"
      }]
    }], null, 2));
    const transcriptResponse = await fetch(`http://localhost:${port}/api/transcripts/run_123456789/0.pdf`);
    const transcriptBytes = new Uint8Array(await transcriptResponse.arrayBuffer());
    assert.equal(transcriptResponse.status, 200);
    assert.match(transcriptResponse.headers.get("content-type"), /application\/pdf/);
    assert.equal(new TextDecoder().decode(transcriptBytes.slice(0, 5)), "%PDF-");
  } finally {
    server.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});
