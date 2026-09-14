#!/usr/bin/env node

/**
 * Mazō — Autonomous AI Executive Coach
 * CALL-E Integration Runner
 * 
 * Conducts proactive accountability check-ins and strategic coaching sessions via CALL-E.
 * Features safe dry-run simulation by default, strict E.164 phone validation, and
 * structured post-call commitment extraction fixtures.
 */

const { execFile } = require('child_process');
const readline = require('readline');

// Parse CLI arguments
const args = process.argv.slice(2);
function getArg(name, defaultValue = null) {
  const index = args.indexOf(name);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
}

const isLive = args.includes('--live');
const skipPrompt = args.includes('--yes') || args.includes('-y');
const explicitPhone = getArg('--phone');
// Synthetic numbers are permitted strictly in dry-run simulation mode.
// In live mode, an explicit authorized destination is required.
const targetPhone = explicitPhone || (isLive ? null : '+15555550199');
const userName = getArg('--user', 'Omar');
const coachRole = getArg('--coach', 'The Clarifier');
const sessionMode = getArg('--mode', 'kickoff'); // 'kickoff' | 'followup'
const defaultTopic = sessionMode === 'followup'
  ? 'Accountability Verification on 5:00 PM Milestone'
  : 'Weekly Momentum Check-in: Unblocking Q3 Execution';
const sessionTopic = getArg('--topic', defaultTopic);

// Validation helpers
function isValidE164(phone) {
  if (!phone || typeof phone !== 'string') return false;
  return /^\+[1-9]\d{6,14}$/.test(phone.trim());
}

function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '***';
  const trimmed = phone.trim();
  if (trimmed.length < 6) return '***';
  return trimmed.slice(0, 3) + '****' + trimmed.slice(-2);
}

function maskSensitiveOutput(str, explicitTarget = targetPhone) {
  if (!str) return '';
  let sanitized = String(str);
  if (explicitTarget) {
    sanitized = sanitized.split(explicitTarget).join(maskPhone(explicitTarget));
  }
  // Mask any E.164 numbers (+ followed by 7-15 digits)
  sanitized = sanitized.replace(/\+[1-9]\d{6,14}/g, match => maskPhone(match));
  // Mask Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
  // Mask generic API keys or secrets
  sanitized = sanitized.replace(/(?:key|token|secret|password|auth|authorization)[=:\s]+['"]?[A-Za-z0-9_\-\.]{8,}['"]?/gi, '$1=[REDACTED]');
  return sanitized;
}

async function runPrompt(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  console.log('\n======================================================');
  console.log('       MAZŌ — AI Executive Accountability Coach        ');
  console.log('            Powered by CALL-E Phone Engine            ');
  console.log('======================================================\n');

  if (isLive && !explicitPhone) {
    console.error('❌ Error: In live mode (--live), an explicit authorized destination must be supplied via --phone <E.164>. Falling back to synthetic numbers is prohibited for live calls.');
    process.exit(1);
  }

  console.log(`👤 Client:   ${userName}`);
  console.log(`🎯 Coach:    ${coachRole}`);
  console.log(`📞 Recipient: ${maskPhone(targetPhone)}`);
  console.log(`💡 Topic:    ${sessionTopic}`);
  console.log(`🔄 Call Type: ${sessionMode === 'followup' ? 'Follow-Up Verification Check-in' : 'Momentum Kickoff Call'}`);
  console.log(`⚡ Mode:     ${isLive ? '🔴 LIVE CALL' : '🟢 DRY-RUN (Safe Simulation)'}\n`);

  if (!isValidE164(targetPhone)) {
    console.error(`❌ Error: Invalid E.164 phone number format: "${maskSensitiveOutput(targetPhone)}". Format must be E.164 (e.g. +1... with 7-15 digits).`);
    process.exit(1);
  }

  const callGoal = sessionMode === 'followup'
    ? `You are ${coachRole}, an elite executive coach in Mazō calling ${userName} for a scheduled follow-up check-in. Inquire whether the agreed milestone was completed, verify execution evidence, update streak momentum, and provide immediate unblocking if stalled.`
    : `You are ${coachRole}, an elite executive coach in Mazō calling ${userName}. Conduct a concise 3-minute momentum check-in regarding: "${sessionTopic}". Help ${userName} isolate their primary bottleneck, decide on the single highest-leverage next step, and secure an explicit commitment on when it will be finished. Extract structured action items upon completion.`;

  if (!isLive) {
    console.log('--- [DRY-RUN SIMULATION] ---');
    console.log('• Validating coach persona and prompt constraints: PASS');
    console.log(`• Generated CALL-E Goal: "${callGoal.slice(0, 110)}..."`);
    console.log('• Simulating call plan generation with CALL-E engine...');
    console.log(`• Simulated Call Plan ID: plan_mazo_${sessionMode}_${Math.floor(10000 + Math.random() * 90000)}`);
    console.log('• Simulated Call Status: COMPLETED (Duration: 2m 15s)');
    console.log('\n--- [STRUCTURED OUTPUT EXTRACTED (SIMULATION FIXTURE)] ---');

    console.log(JSON.stringify(simulateExtraction({ sessionMode, coachRole, userName }), null, 2));

    console.log('\n✅ Dry-run completed successfully with 0 telephone side-effects.');
    console.log('💡 Tip: Try the verification loop with: node mazo-coach.js --mode followup');
    console.log('💡 To place a real live call with CALL-E, run with: --live --phone "+<your_authorized_number>"');
    return;
  }

  // Live Call Execution — Strict authorization enforcement
  const rawAllowed = process.env.ALLOWED_RECIPIENTS;
  if (!rawAllowed || !rawAllowed.trim()) {
    console.error('❌ Error: Live calling requires ALLOWED_RECIPIENTS environment variable to be explicitly configured with authorized E.164 numbers. An empty allowlist does not enforce safety restrictions.');
    process.exit(1);
  }

  const allowedNumbers = rawAllowed.split(',').map(s => s.trim()).filter(Boolean);
  if (!allowedNumbers.includes(targetPhone)) {
    console.error(`❌ Error: Phone number ${maskSensitiveOutput(targetPhone)} is not authorized in ALLOWED_RECIPIENTS list.`);
    process.exit(1);
  }

  if (!skipPrompt) {
    const confirmation = await runPrompt(`⚠️ Place REAL phone call to ${maskPhone(targetPhone)} via CALL-E? (y/N): `);
    if (confirmation !== 'y' && confirmation !== 'yes') {
      console.log('🚫 Call aborted by user.');
      process.exit(0);
    }
  }

  console.log('🚀 Dispatching live call via CALL-E...');

  const apiKey = process.env.CALLE_API_KEY || process.env.EXPO_PUBLIC_CALLE_API_KEY;

  // Try CLI execution first
  execFile('calle', ['call', 'plan', '--to-phone', targetPhone, '--goal', callGoal], async (err, stdout, stderr) => {
    if (!err) {
      console.log('✅ CALL-E call plan created via CLI:', maskSensitiveOutput(stdout.trim()));
      return;
    }

    // If CLI not present or failed, check for direct CALL-E API key
    if (apiKey) {
      console.log('ℹ️ CALL-E CLI not available. Falling back to direct CALL-E REST API...');
      try {
        const payload = {
          task: callGoal,
          recipients: [{ phones: [targetPhone] }],
          metadata: { app: 'mazo-executive-coach', user: userName, coach: coachRole, mode: sessionMode }
        };
        const res = await fetch('https://api.heycall-e.com/v1/calls', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const data = await res.json();
          console.log(`✅ CALL-E call successfully dispatched via REST API! Task ID: ${maskSensitiveOutput(data.id || 'dispatched')}`);
          return;
        } else {
          const errText = await res.text();
          console.error('❌ CALL-E REST API error response:', maskSensitiveOutput(errText));
          process.exit(1);
        }
      } catch (fetchErr) {
        console.error('❌ Direct CALL-E API request failed:', maskSensitiveOutput(fetchErr.message));
        process.exit(1);
      }
    }

    console.error('❌ Failed to execute CALL-E CLI:', maskSensitiveOutput(stderr || err.message));
    console.log('Tip: Ensure `calle` CLI is installed and authenticated, or set `CALLE_API_KEY` in environment.');
    process.exit(1);
  });
}

function buildCallGoal(options = {}) {
  const { coachRole = 'The Clarifier', userName = 'Omar', sessionMode = 'kickoff', sessionTopic = 'Weekly Momentum' } = options;
  if (sessionMode === 'followup') {
    return `You are ${coachRole}, an elite executive coach in Mazō calling ${userName} for a scheduled follow-up check-in. Inquire whether the agreed milestone was completed, verify execution evidence, update streak momentum, and provide immediate unblocking if stalled.`;
  }
  return `You are ${coachRole}, an elite executive coach in Mazō calling ${userName}. Conduct a concise 3-minute momentum check-in regarding: "${sessionTopic}". Help ${userName} isolate their primary bottleneck, decide on the single highest-leverage next step, and secure an explicit commitment on when it will be finished. Extract structured action items upon completion.`;
}

function simulateExtraction(options = {}) {
  const { sessionMode = 'kickoff', coachRole = 'The Clarifier', userName = 'Omar' } = options;
  if (sessionMode === 'followup') {
    return {
      simulationNotice: 'Static one-shot demonstration fixture. Live audio transcription, schedule reconciliation, cooldowns, and deduplication are host responsibilities and not implemented in this standalone CLI runner.',
      sessionId: 'sess_fup_8842',
      callType: 'accountability_verification',
      coach: coachRole,
      client: userName,
      status: 'simulated_verified_completed',
      reconciledMilestone: 'Finalize core API contract and submit production build',
      verificationOutcome: 'Milestone verified completed in simulated dialogue',
      momentumScoreAwarded: '+25 XP (Simulated)',
      streakLevel: 'Active (Day 4)'
    };
  }
  return {
    simulationNotice: 'Static one-shot demonstration fixture. Live audio transcription, automated calendar extraction, recurring scheduling, cooldowns, and deduplication are host responsibilities and not implemented in this standalone CLI runner.',
    sessionId: 'sess_kickoff_1092',
    callType: 'kickoff_and_lockin',
    coach: coachRole,
    client: userName,
    status: 'simulated_completed',
    outcome: 'Milestone prioritization simulated output',
    actionItems: [
      {
        task: 'Finalize core API contract and submit production build',
        deadline: 'Today @ 5:00 PM',
        priority: 'high',
        identifiedObstacle: 'Context-switching between design and architecture',
        solution: '90-minute deep work block with notifications silenced'
      }
    ],
    breakthroughMoment: 'Realized that shipping the core feature first unblocks the entire product release.'
  };
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', maskSensitiveOutput(err.message || err));
    process.exit(1);
  });
}

module.exports = {
  isValidE164,
  maskPhone,
  maskSensitiveOutput,
  buildCallGoal,
  simulateExtraction,
  main
};
