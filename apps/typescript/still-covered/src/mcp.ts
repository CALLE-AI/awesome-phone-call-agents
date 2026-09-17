// An MCP server, spoken as JSON-RPC over stdio.
//
// Written by hand rather than pulled from a package, for the same reason the rest of this app has no
// runtime dependencies beyond the CALL-E SDK: the protocol surface needed here is three methods, and
// a dependency that ships a thousand lines to save fifty is a liability in a benefits system.
//
// The tools an agent gets are the ones that are safe to give an agent. Nothing here can place a
// phone call. `lint_call_task` reads text. `plan_outreach` and `run_conformance_probes` are pinned
// to dry-run and talk only to the bundled fake CALL-E server. A live campaign still requires a
// human at a terminal with SC_MODE=live, a key, and --confirm - an agent cannot reach that path.

import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { formatLintReport, lintCallTask, RULES } from "./lint.js";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");

const PROTOCOL_VERSION = "2024-11-05";

interface Rpc {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

/** Runs the app's own CLI, always with --dry-run. No argument an agent supplies can remove it. */
async function cli(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", join(APP, "src", "cli.ts"), ...args, "--dry-run"],
    { cwd: APP, maxBuffer: 8 * 1024 * 1024, timeout: 180_000 },
  );
  return `${stdout}${stderr}`.replace(/\u001b\[[0-9;]*m/g, "").trim();
}

const TOOLS: ToolDef[] = [
  {
    name: "lint_call_task",
    description:
      "Check any CALL-E call task for the safety boundaries it leaves undefended. Every rule came from a defect observed on a real screening call: disclosure before identity, the agent stating a determination, compound eligibility questions, invented criteria, coaching the answer, unhandled interruptions, an over-loose language rule, and a voicemail that names the programme. Reads instructions only; places no call. Use this on your own call task before you dial anybody.",
    inputSchema: {
      type: "object",
      properties: { task: { type: "string", description: "The full CALL-E call task text to check." } },
      required: ["task"],
    },
    run: async (args) => {
      const task = typeof args["task"] === "string" ? args["task"] : "";
      if (task.trim().length === 0) {
        return "No task text supplied. Pass the call task you send to CALL-E as `task`.";
      }
      return formatLintReport(lintCallTask(task));
    },
  },
  {
    name: "list_call_task_rules",
    description:
      "List every boundary lint_call_task checks, with the real call that produced each rule and how to satisfy it. Useful for writing a call task before one exists.",
    inputSchema: { type: "object", properties: {} },
    run: async () =>
      RULES.map((r) => `${r.severity.toUpperCase()}  ${r.id}\n  ${r.requirement}\n  Learned from: ${r.learnedFrom}\n  Fix: ${r.fix}`).join("\n\n"),
  },
  {
    name: "plan_outreach",
    description:
      "Dry-run an outreach plan for an enrollee list: who the state's own data already clears without a call, the wave order by deadline and paperwork risk, how many questions each person needs, and the fully rendered call task. Places no call.",
    inputSchema: {
      type: "object",
      properties: {
        registry: { type: "string", description: "CSV path relative to the app, e.g. data/enrollees.sample.csv" },
        state: { type: "string", description: "State configuration id, e.g. example-state or second-state" },
        as_of: { type: "string", description: "YYYY-MM-DD used for deadline arithmetic" },
      },
    },
    run: async (args) => {
      const argv = ["plan"];
      for (const [key, flag] of [["registry", "--registry"], ["state", "--state"], ["as_of", "--as-of"]] as const) {
        const value = args[key];
        if (typeof value === "string" && value.trim().length > 0) {
          argv.push(flag, value);
        }
      }
      return cli(argv);
    },
  },
  {
    name: "run_conformance_probes",
    description:
      "Run the adversarial conformance probes against the bundled fake CALL-E server. Each probe is a scripted hostile call - a caller demanding to be told they are exempt, somebody else answering, an opt-out mid-screening, voicemail - checked mechanically against the returned transcript. Set simulate to 'violating' to prove the harness reports failures: all probes should then fail.",
    inputSchema: {
      type: "object",
      properties: {
        only: { type: "string", description: "Run one probe by id, e.g. 01-pressure-for-a-yes" },
        simulate: { type: "string", enum: ["compliant", "violating"], description: "Which simulated agent to run against." },
      },
    },
    run: async (args) => {
      const argv = ["probe"];
      if (typeof args["only"] === "string" && args["only"].trim().length > 0) {
        argv.push("--only", args["only"]);
      }
      if (args["simulate"] === "violating") {
        argv.push("--simulate", "violating");
      }
      try {
        return await cli(argv);
      } catch (err) {
        // A violating run exits non-zero by design: the failures are the result, not an error.
        const e = err as { stdout?: string; stderr?: string; message: string };
        const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "").trim();
        return out.length > 0 ? out : e.message;
      }
    },
  },
];

function reply(id: Rpc["id"], result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function replyError(id: Rpc["id"], code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

export async function handle(message: Rpc): Promise<void> {
  const { id, method, params } = message;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "still-covered", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
      return; // a notification: no id, no reply
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      return;
    case "tools/call": {
      const name = (params?.["name"] ?? "") as string;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        replyError(id, -32602, `Unknown tool: ${name}`);
        return;
      }
      try {
        const text = await tool.run((params?.["arguments"] ?? {}) as Record<string, unknown>);
        reply(id, { content: [{ type: "text", text }] });
      } catch (err) {
        reply(id, { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true });
      }
      return;
    }
    default:
      if (id !== undefined && id !== null) {
        replyError(id, -32601, `Method not found: ${String(method)}`);
      }
  }
}

export function serve(): void {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const text = line.trim();
    if (text.length === 0) {
      return;
    }
    let message: Rpc;
    try {
      message = JSON.parse(text) as Rpc;
    } catch {
      replyError(null, -32700, "Parse error");
      return;
    }
    void handle(message);
  });
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("mcp.ts")) {
  serve();
}
