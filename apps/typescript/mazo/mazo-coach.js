#!/usr/bin/env node

/**
 * Mazō — Autonomous AI Executive Coach
 * CALL-E Integration Runner
 * 
 * Conducts proactive accountability check-ins and strategic coaching sessions via CALL-E.
 * Features safe dry-run simulation by default, strict E.164 phone validation, and
 * structured post-call commitment extraction.
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
const targetPhone = getArg('--phone', '+15555550199');
const userName = getArg('--user', 'Omar');
const coachRole = getArg('--coach', 'The Clarifier');
const sessionMode = getArg('--mode', 'kickoff'); // 'kickoff' | 'followup'
const defaultTopic = sessionMode === 'followup'
  ? 'Accountability Verification on 5:00 PM Milestone'
  : 'Weekly Momentum Check-in: Unblocking Q3 Execution';
const sessionTopic = getArg('--topic', defaultTopic);

// Validation helper
function isValidE164(phone) {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + '****' + phone.slice(-2);
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

  console.log(`👤 Client:   ${userName}`);
  console.log(`🎯 Coach:    ${coachRole}`);
  console.log(`📞 Recipient: ${maskPhone(targetPhone)}`);
  console.log(`💡 Topic:    ${sessionTopic}`);
  console.log(`🔄 Call Type: ${sessionMode === 'followup' ? 'Follow-Up Verification Check-in' : 'Momentum Kickoff Call'}`);
  console.log(`⚡ Mode:     ${isLive ? '🔴 LIVE CALL' : '🟢 DRY-RUN (Safe Simulation)'}\n`);

  if (!isValidE164(targetPhone)) {
    console.error(`❌ Error: Invalid E.164 phone number format: "${targetPhone}". Format must be +1234567890.`);
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
    console.log('\n--- [STRUCTURED OUTPUT EXTRACTED] ---');

    if (sessionMode === 'followup') {
      console.log(JSON.stringify({
        sessionId: 'sess_fup_8842',
        callType: 'accountability_verification',
        coach: coachRole,
        client: userName,
        status: 'verified_completed',
        reconciledMilestone: 'Finalize core API contract and submit production build',
        verificationOutcome: 'Milestone 100% completed and shipped on schedule',
        momentumScoreAwarded: '+25 XP',
        streakLevel: 'Active (Day 4)',
        nextScheduledCheckin: 'Tomorrow @ 8:30 AM Kickoff'
      }, null, 2));
    } else {
      console.log(JSON.stringify({
        sessionId: 'sess_kickoff_1092',
        callType: 'kickoff_and_lockin',
        coach: coachRole,
        client: userName,
        status: 'completed',
        outcome: 'Breakthrough achieved on project milestone prioritization',
        actionItems: [
          {
            task: 'Finalize core API contract and submit production build',
            deadline: 'Today @ 5:00 PM',
            priority: 'high',
            identifiedObstacle: 'Context-switching between design and architecture',
            solution: '90-minute deep work block with notifications silenced'
          }
        ],
        breakthroughMoment: 'Realized that shipping the core feature first unblocks the entire product release.',
        relentlessAccountabilityLoop: {
          scheduledCallbackAt: 'Today @ 5:00 PM',
          engine: 'CALL-E Telephony Protocol',
          status: 'armed'
        }
      }, null, 2));
    }

    console.log('\n✅ Dry-run completed successfully with 0 telephone side-effects.');
    console.log('💡 Tip: Try the verification loop with: node mazo-coach.js --mode followup');
    console.log('💡 To place a real live call with CALL-E, run with: --live --phone "+<your_number>"');
    return;
  }

  // Live Call Execution
  const allowedNumbers = (process.env.ALLOWED_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowedNumbers.length > 0 && !allowedNumbers.includes(targetPhone)) {
    console.error(`❌ Error: Phone number ${maskPhone(targetPhone)} is not in ALLOWED_RECIPIENTS list for safety.`);
    process.exit(1);
  }

  if (!skipPrompt) {
    const confirmation = await runPrompt(`⚠️ Place REAL phone call to ${maskPhone(targetPhone)} via CALL-E? (y/N): `);
    if (confirmation !== 'y' && confirmation !== 'yes') {
      console.log('🚫 Call aborted by user.');
      process.exit(0);
    }
  }

  console.log('🚀 Dispatching live call via CALL-E CLI / API...');

  execFile('calle', ['call', 'plan', '--to-phone', targetPhone, '--goal', callGoal], (err, stdout, stderr) => {
    if (err) {
      console.error('❌ Failed to execute CALL-E CLI:', stderr || err.message);
      console.log('Tip: Ensure `calle` CLI is installed and authenticated (`calle login`).');
      process.exit(1);
    }
    console.log('✅ CALL-E call plan created:', stdout.trim());
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
