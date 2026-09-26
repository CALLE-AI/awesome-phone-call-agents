const { spawn, spawnSync } = require("node:child_process");

function isSimulationMode() {
  return (process.env.BRIDGE_MODE || 'simulation').toLowerCase() === 'simulation';
}

function buildSimulationCallPayload({ phone, goal }) {
  const stamp = Date.now();
  return {
    stdout: JSON.stringify({
      plan_id: `sim-plan-${stamp}`,
      confirm_token: `sim-confirm-${stamp}`,
      mode: isSimulationMode() ? 'simulation' : 'live',
      to_phone: phone,
      goal,
      status: 'planned'
    }),
    stderr: ""
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
    if (isSimulationMode() && !commandExists('calle')) {
      resolve(buildSimulationCallPayload({
        phone: args.includes('--to-phone') ? args[args.indexOf('--to-phone') + 1] : undefined,
        goal: args.includes('--goal') ? args[args.indexOf('--goal') + 1] : undefined
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
        const simulated = buildSimulationCallPayload({
          phone: args.includes('--to-phone') ? args[args.indexOf('--to-phone') + 1] : undefined,
          goal: args.includes('--goal') ? args[args.indexOf('--goal') + 1] : undefined
        });
        resolve(simulated);
        return;
      }

      reject(error);
    });

    child.on("close", code => {
      if (code !== 0) {
        const fallback = isSimulationMode()
          ? buildSimulationCallPayload({
              phone: args.includes('--to-phone') ? args[args.indexOf('--to-phone') + 1] : undefined,
              goal: args.includes('--goal') ? args[args.indexOf('--goal') + 1] : undefined
            })
          : { stdout: '', stderr };

        if (isSimulationMode()) {
          resolve(fallback);
          return;
        }

        reject(
          new Error(
            `CALL-E exited with code ${code}\n${stderr}`
          )
        );

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