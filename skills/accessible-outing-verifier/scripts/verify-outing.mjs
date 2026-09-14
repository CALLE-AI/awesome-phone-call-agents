#!/usr/bin/env node

/**
 * verify-outing.mjs
 *
 * Standalone offline runner for the accessible-outing-verifier skill.
 * Demonstrates one advisory fixture rule; no live integration is implemented.
 *
 * Usage:
 *   node scripts/verify-outing.mjs [--profile path/to/synthetic-profile.json]
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1. Argument parsing
const args = process.argv.slice(2);
let profilePath = join(__dirname, '../assets/sample-outing-request.json');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--profile' && args[i + 1]) {
    profilePath = args[i + 1];
    i++;
  } else if (args[i] === '--real') {
    console.error('[ERROR] --real is unsupported: this helper is offline-only and cannot place a call.');
    process.exit(2);
  }
}

if (!existsSync(profilePath)) {
  console.error(`[ERROR] Profile file not found: ${profilePath}`);
  process.exit(1);
}

const profile = JSON.parse(readFileSync(profilePath, 'utf8'));

console.log('============================================================');
console.log('       CALL-E SKILL: ACCESSIBLE OUTING VERIFIER');
console.log('============================================================');
console.log(`Target Venue: ${profile.venue_name}`);
console.log(`Phone:        ${profile.phone ? '***' + String(profile.phone).replace(/\D/g, '').slice(-4) : 'N/A'}`);
console.log(`Persona:      ${profile.persona}`);
console.log('Mode:         OFFLINE DRY-RUN (Default)\n');

// 2. Digital Gap Triage
console.log('[Phase 1] Digital Gap Triage:');
const digitalEvidence = profile.digital_evidence || [];
const physicalGaps = [];

for (const constraint of profile.constraints) {
  const found = digitalEvidence.find((d) => d.constraint_id === constraint.id);
  if (found && found.status === 'confirmed') {
    console.log(`  [FIXTURE] ${constraint.label} (Supplied source label: ${found.source})`);
  } else {
    console.log(`  [GAP]  ${constraint.label} (${constraint.category === 'daily_operational' ? 'CRITICAL OPERATIONAL GAP' : 'Missing'})`);
    physicalGaps.push(constraint);
  }
}

if (physicalGaps.length === 0) {
  console.log('\nAll supplied fixture constraints are labeled confirmed. No phone call was made.');
  console.log('FINAL VERDICT: ADVISORY ONLY — HUMAN VERIFICATION REQUIRED');
  process.exit(0);
}

// 3. Telephony actuation
console.log(`\n[Phase 2] CALL-E Bounded Actuation (${physicalGaps.length} gaps to verify):`);
console.log('  Task: Simulate an accessibility verification question; no call is placed.');
console.log('  Human Consent Gate: Simulated only; no live authorization was obtained.\n');

// In dry-run mode, simulate the Hero Demotion scenario
const simulatedStaffResponse = {
  elevator_operational: 'qualified_confirmation',
  staff_quote: 'I think it should be working, but maintenance has not signed off yet today.',
  confidence: 'medium'
};

console.log('[Phase 3] Deterministic Safety Firewall:');
console.log(`  Raw Telephony Output: "${simulatedStaffResponse.elevator_operational}"`);
console.log(`  Staff Quote:          "${simulatedStaffResponse.staff_quote}"`);

// Enforce strict demotion rule
let normalizedStatus = simulatedStaffResponse.elevator_operational;
if (simulatedStaffResponse.elevator_operational === 'qualified_confirmation') {
  normalizedStatus = 'UNKNOWN';
  console.log('  -> FIREWALL TRIGGER: "qualified_confirmation" detected.');
  console.log('  -> ACTION: Demoting constraint strictly to UNKNOWN.');
  console.log('  -> RATIONALE: Hedged claims must never authorize physical safety.\n');
}

// 4. Executive Feasibility Brief
console.log('============================================================');
console.log('                  FEASIBILITY BRIEF');
console.log('============================================================');
console.log(`Overall Outing Verdict: NOT FULLY VERIFIED (SAFETY DEMOTION)`);
console.log('Recommendation: Do not dispatch user without on-site backup plan.');
console.log('============================================================\n');
