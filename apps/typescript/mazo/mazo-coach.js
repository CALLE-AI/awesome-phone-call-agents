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
const sessionTopic = getArg('--topic', 'Weekly Momentum Check-in: Unblocking Q3 Execution');

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
  console.log(`⚡ Mode:     ${isLive ? '🔴 LIVE CALL' : '🟢 DRY-RUN (Safe Simulation)'}\n`);

  if (!isValidE164(targetPhone)) {
    console.error(`❌ Error: Invalid E.164 phone number format: "${targetPhone}". Format must be +1234567890.`);
    process.exit(1);
  }

  const callGoal = `You are ${coachRole}, an elite executive coach in Mazō calling ${userName}. Conduct a concise 3-minute momentum check-in regarding: "${sessionTopic}". Help ${userName} isolate their primary bottleneck, decide on the single highest-leverage next step, and secure an explicit commitment on when it will be finished. Extract structured action items upon completion.`;

  if (!isLive) {
    console.log('--- [DRY-RUN SIMULATION] ---');
    console.log('• Validating coach persona and prompt constraints: PASS');
    console.log(`• Generated CALL-E Goal: "${callGoal.slice(0, 110)}..."`);
    console.log('• Simulating call plan generation with CALL-E engine...');
    console.log('• Simulated Call Plan ID: plan_mazo_demo_88291');
    console.log('• Simulated Call Status: COMPLETED (Duration: 2m 45s)');
    console.log('\n--- [STRUCTURED OUTPUT EXTRACTED] ---');
    console.log(JSON.stringify({
      sessionId: 'sess_demo_1092',
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
      nextScheduledCheckin: 'Tomorrow @ 9:00 AM'
    }, null, 2));

    console.log('\n✅ Dry-run completed successfully with 0 telephone side-effects.');
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
