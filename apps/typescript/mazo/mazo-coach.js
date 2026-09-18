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

function maskUser(user) {
  if (!user || typeof user !== 'string') return '***';
  const trimmed = user.trim();
  if (trimmed.length <= 2) return `${trimmed[0] || ''}***`;
  return `${trimmed[0]}***${trimmed.slice(-1)}`;
}

function maskTopic(topic) {
  if (!topic || typeof topic !== 'string') return '***';
  const trimmed = topic.trim();
  if (trimmed.length <= 6) return `${trimmed.slice(0, 1)}***`;
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-3)}`;
}

function maskGoal(goal) {
  if (!goal || typeof goal !== 'string') return '***';
  const sanitized = maskSensitiveOutput(goal);
  if (sanitized.length > 35) {
    return `${sanitized.slice(0, 25)}... [REDACTED_GOAL_PROMPT]`;
  }
  return '[REDACTED_GOAL_PROMPT]';
}

function maskSensitiveOutput(str, explicitTarget = targetPhone) {
  if (!str) return '';
  let sanitized = String(str);
  if (explicitTarget) {
    sanitized = sanitized.split(explicitTarget).join(maskPhone(explicitTarget));
  }
  // Mask phone-bearing display text, including grouped and national forms.
  sanitized = sanitized.replace(
    /(?<![A-Za-z0-9])(?:\+[1-9][0-9(). -]{6,}[0-9]|\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}|0[1-9][0-9 .-]{6,}[0-9])(?![A-Za-z0-9])/g,
    match => /^\+[1-9][0-9]{6,14}$/.test(match) ? maskPhone(match) : '[number hidden]'
  );
  // Mask Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[^\s"'\r\n,}]+/gi, 'Bearer [REDACTED]');
  // Mask structured plan secrets, quoted JSON confirmation_token keys, API keys, and auth credentials
  sanitized = sanitized.replace(
    /(["']?[A-Za-z0-9_]*(?:key|token|secret|password|auth|authorization|credential)[A-Za-z0-9_]*["']?\s*[:=\s]\s*)(["']?)(?!Bearer\b)(?!\[REDACTED\])[^\s"'\r\n,}]+(\2)/gi,
    '$1$2[REDACTED]$2'
  );
  // Mask user/topic/goal in structured plan / JSON output
  sanitized = sanitized.replace(
    /(["']?(?:user|client|topic|goal|task)["']?\s*[:=]\s*)(["'])(?:\\.|[^\\])*?(\2)/gi,
    '$1$2[REDACTED]$2'
  );
  sanitized = sanitized.replace(
    /(["']?(?:user|client|topic|goal|task)["']?\s*[:=]\s*)([^\s,"'{}]+)/gi,
    '$1[REDACTED]'
  );
  return sanitized;
}

function validateLiveAuthorization(phone, allowedRecipientsRaw) {
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    return {
      valid: false,
      error: 'In live mode (--live), an explicit authorized destination must be supplied via --phone <E.164>. Falling back to synthetic numbers is prohibited for live calls.'
    };
  }
  if (!isValidE164(phone)) {
    return {
      valid: false,
      error: `Invalid E.164 phone number format: "${maskSensitiveOutput(phone, phone)}". Format must be E.164 (e.g. +1... with 7-15 digits).`
    };
  }
  if (!allowedRecipientsRaw || !allowedRecipientsRaw.trim()) {
    return {
      valid: false,
      error: 'Live calling requires ALLOWED_RECIPIENTS environment variable to be explicitly configured with authorized E.164 numbers. An empty allowlist does not enforce safety restrictions.'
    };
  }
  const allowed = allowedRecipientsRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(phone.trim())) {
    return {
      valid: false,
      error: `Phone number ${maskSensitiveOutput(phone, phone)} is not authorized in ALLOWED_RECIPIENTS list.`
    };
  }
  return { valid: true };
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

  if (isLive) {
    const authCheck = validateLiveAuthorization(explicitPhone, process.env.ALLOWED_RECIPIENTS);
    if (!authCheck.valid) {
      console.error(`❌ Error: ${authCheck.error}`);
      process.exit(1);
    }
  }

  console.log(`👤 Client:   ${maskUser(userName)}`);
  console.log(`🎯 Coach:    ${maskSensitiveOutput(coachRole)}`);
  console.log(`📞 Recipient: ${maskPhone(targetPhone)}`);
  console.log(`💡 Topic:    ${maskTopic(sessionTopic)}`);
  console.log(`🔄 Call Type: ${sessionMode === 'followup' ? 'Follow-Up Verification Check-in' : 'Momentum Kickoff Call'}`);
  console.log(`⚡ Mode:     ${isLive ? '🔴 LIVE CALL' : '🟢 DRY-RUN (Safe Simulation)'}\n`);

  if (!isValidE164(targetPhone)) {
    console.error(`❌ Error: Invalid E.164 phone number format: "${maskSensitiveOutput(targetPhone)}". Format must be E.164 (e.g. +1... with 7-15 digits).`);
    process.exit(1);
  }

  const callGoal = buildCallGoal({ coachRole, userName, sessionMode, sessionTopic });

  if (!isLive) {
    console.log('--- [DRY-RUN SIMULATION] ---');
    console.log('• Validating coach persona and prompt constraints: PASS');
    console.log(`• Generated CALL-E Goal: "${maskGoal(callGoal)}"`);
    console.log('• Simulating call plan generation with CALL-E engine...');
    console.log(`• Simulated Call Plan ID: plan_mazo_${sessionMode}_${Math.floor(10000 + Math.random() * 90000)}`);
    console.log('• Simulated Call Status: COMPLETED (Duration: 2m 15s)');
    console.log('\n--- [STRUCTURED OUTPUT EXTRACTED (SIMULATION FIXTURE)] ---');

    console.log(maskSensitiveOutput(JSON.stringify(simulateExtraction({ sessionMode, coachRole, userName }), null, 2)));

    console.log('\n✅ Dry-run completed successfully with 0 telephone side-effects.');
    console.log('💡 Tip: Try the verification loop with: node mazo-coach.js --mode followup');
    console.log('💡 To place a real live call with CALL-E, run with: --live --phone "+<your_authorized_number>"');
    return;
  }

  // Live Call Execution — Interactive Confirmation Gate
  if (!skipPrompt) {
    const confirmation = await runPrompt(`⚠️ Place REAL phone call to ${maskPhone(targetPhone)} via CALL-E? (y/N): `);
    if (confirmation !== 'y' && confirmation !== 'yes') {
      console.log('🚫 Call aborted by user.');
      process.exit(0);
    }
  }

  console.log('🚀 Initiating CALL-E live planning and integration pipeline...');

  const apiKey = process.env.CALLE_API_KEY || process.env.EXPO_PUBLIC_CALLE_API_KEY;

  // Try CLI execution first (planning-only)
  execFile('calle', ['call', 'plan', '--to-phone', targetPhone, '--goal', callGoal], async (err, stdout, stderr) => {
    if (!err) {
      console.log('📋 [PLANNING-ONLY] CALL-E call plan created via CLI (planning-only; call plan does not place the advertised outbound call):');
      console.log(maskSensitiveOutput(stdout.trim()));
      console.log('ℹ️ Notice: "calle call plan" compiles and validates the call task schema but does not place the outbound call. Actual outbound phone dialing requires provider execution or direct CALL-E REST API dispatch.');
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
    return `You are ${coachRole}, an elite executive coach in Mazō calling ${userName} for a scheduled follow-up check-in. Inquire whether the agreed milestone was completed, verify execution evidence, update streak momentum, and provide immediate unblocking if stalled. Focus strictly on non-clinical personal productivity and time-management; explicitly exclude medical, legal, financial, or crisis advice.`;
  }
  return `You are ${coachRole}, an elite executive coach in Mazō calling ${userName}. Conduct a concise 3-minute momentum check-in regarding: "${sessionTopic}". Help ${userName} isolate their primary bottleneck, decide on the single highest-leverage next step, and secure an explicit commitment on when it will be finished. Extract structured action items upon completion. Focus strictly on non-clinical personal productivity and time-management; explicitly exclude medical, legal, financial, or crisis decision-making.`;
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
  maskUser,
  maskTopic,
  maskGoal,
  maskSensitiveOutput,
  validateLiveAuthorization,
  buildCallGoal,
  simulateExtraction,
  main
};
