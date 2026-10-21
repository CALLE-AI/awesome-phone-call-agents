const { spawn, spawnSync } = require("node:child_process");

function isLiveMode() {
  return (process.env.BRIDGE_MODE || '').toLowerCase() === 'live';
}

function isSimulationMode() {
  return !isLiveMode();
}

function maskPhoneNumber(phone) {
  if (!phone) return '+91******';
  const str = String(phone).trim();
  if (str.includes('*')) return str;
  if (str.startsWith('+')) {
    const cc = str.slice(0, 3);
    const last4 = str.slice(-4);
    return `${cc}******${last4}`;
  }
  const last4 = str.slice(-4);
  return `******${last4}`;
}

function buildSimulationCallPayload({ phone, goal, planId, runId, command } = {}) {
  const stamp = Date.now();
  return {
    stdout: JSON.stringify({
      plan_id: planId || `sim-plan-${stamp}`,
      confirm_token: `sim-confirm-${stamp}`,
      run_id: runId || `sim-run-${stamp}`,
      mode: 'simulation',
      simulated: true,
      isLive: false,
      fixtureFallback: false,
      to_phone: maskPhoneNumber(phone),
      goal,
      status: command === 'run' ? 'in_progress' : command === 'status' ? 'completed' : 'planned'
    }),
    stderr: ""
  };
}

function buildFallbackCallPayload({ phone, goal, planId, runId, stderr = "" } = {}) {
  const stamp = Date.now();
  return {
    stdout: JSON.stringify({
      plan_id: planId || `sim-plan-${stamp}`,
      confirm_token: `sim-confirm-${stamp}`,
      run_id: runId || `sim-run-${stamp}`,
      mode: 'simulation',
      simulated: true,
      isLive: false,
      fixtureFallback: true,
      to_phone: maskPhoneNumber(phone),
      goal,
      status: 'planned',
      note: 'Fixture fallback executed; not a real live completion.'
    }),
    stderr
  };
}

function commandExists(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    encoding: 'utf8',
    shell: false
  });
  return !result.error && result.status === 0 && Boolean(result.stdout && result.stdout.trim());
}

function runCalle(args) {
  return new Promise((resolve, reject) => {
    // Keep simulation unable to invoke the real CLI under all circumstances
    if (isSimulationMode()) {
      resolve(buildSimulationCallPayload({
        phone: args.includes('--to-phone') ? args[args.indexOf('--to-phone') + 1] : undefined,
        goal: args.includes('--goal') ? args[args.indexOf('--goal') + 1] : undefined,
        planId: args.includes('--plan-id') ? args[args.indexOf('--plan-id') + 1] : undefined,
        runId: args.includes('--run-id') ? args[args.indexOf('--run-id') + 1] : undefined,
        command: args[1]
      }));
      return;
    }

    if (!commandExists('calle')) {
      resolve(buildFallbackCallPayload({
        phone: args.includes('--to-phone') ? args[args.indexOf('--to-phone') + 1] : undefined,
        goal: args.includes('--goal') ? args[args.indexOf('--goal') + 1] : undefined,
        planId: args.includes('--plan-id') ? args[args.indexOf('--plan-id') + 1] : undefined,
        runId: args.includes('--run-id') ? args[args.indexOf('--run-id') + 1] : undefined,
        stderr: 'CALL-E CLI not available on system'
      }));
      return;
    }

    const child = spawn(
      "calle",
      args,
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", data => {
      stdout += data.toString();
    });

    child.stderr.on("data", data => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      if (isSimulationMode() || error.code === 'ENOENT') {
        const fallback = buildFallbackCallPayload({
          phone: args.includes('--to-phone') ? args[args.indexOf('--to-phone') + 1] : undefined,
          goal: args.includes('--goal') ? args[args.indexOf('--goal') + 1] : undefined,
          stderr: error.message
        });
        resolve(fallback);
        return;
      }

      reject(error);
    });

    child.on("close", code => {
      if (code !== 0) {
        // Never label fixture fallback as real live completion
        resolve(buildFallbackCallPayload({
          phone: args.includes('--to-phone') ? args[args.indexOf('--to-phone') + 1] : undefined,
          goal: args.includes('--goal') ? args[args.indexOf('--goal') + 1] : undefined,
          stderr: `CALL-E exited with code ${code}\n${stderr}`
        }));
        return;
      }

      resolve({
        stdout,
        stderr
      });
    });
  });
}


async function planCall({
  phone,
  goal
}) {

  return runCalle([
    "call",
    "plan",
    "--to-phone",
    phone,
    "--goal",
    goal,
    "--json"
  ]);
}


async function runCall({
  planId,
  confirmToken
}) {

  return runCalle([
    "call",
    "run",
    "--plan-id",
    planId,
    "--confirm-token",
    confirmToken,
    "--json"
  ]);
}


async function getCallStatus({
  runId
}) {

  return runCalle([
    "call",
    "status",
    "--run-id",
    runId,
    "--timezone",
    "Asia/Calcutta",
    "--json"
  ]);
}


function extractJson(output) {

  const text =
    output.stdout.trim();

  try {
    return JSON.parse(text);
  } catch {

    const firstBrace =
      text.indexOf("{");

    const lastBrace =
      text.lastIndexOf("}");

    if (
      firstBrace !== -1 &&
      lastBrace !== -1
    ) {
      return JSON.parse(
        text.slice(
          firstBrace,
          lastBrace + 1
        )
      );
    }

    throw new Error(
      `Could not parse CALL-E JSON:\n${text}`
    );
  }
}


module.exports = {
  runCalle,
  planCall,
  runCall,
  getCallStatus,
  extractJson
};