#!/usr/bin/env node

const HELP = `Usage:
  node skills/call-reminder/scripts/detect-client.mjs [--plain] [--help]

Detects a likely call-reminder client adapter from environment hints.
Falls back to external-cron when no safer host-specific adapter is detected.
`;

function detectClient(env = process.env) {
  const keys = Object.keys(env);
  const hasKey = (pattern) => keys.some((key) => pattern.test(key));
  const hasValue = (pattern) => Object.values(env).some((value) => pattern.test(String(value)));

  if (env.CODEX_HOME || env.CODEX_SANDBOX || hasKey(/^CODEX_/)) {
    return {
      adapterId: "codex-app",
      confidence: "medium",
      reason: "CODEX environment variables are present.",
    };
  }

  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT || hasKey(/^CLAUDE/)) {
    return {
      adapterId: "claude-code-desktop",
      confidence: "low",
      reason: "Claude-related environment variables are present, but routine support was not proven.",
    };
  }

  if (env.OPENCLAW_HOME || hasKey(/^OPENCLAW/) || hasValue(/openclaw/i)) {
    return {
      adapterId: "openclaw",
      confidence: "medium",
      reason: "OpenClaw environment hints are present.",
    };
  }

  if (env.CURSOR_TRACE_ID || hasValue(/cursor/i)) {
    return {
      adapterId: "cursor",
      confidence: "low",
      reason: "Cursor environment hints are present.",
    };
  }

  if (env.GITHUB_ACTIONS || env.CODESPACES || hasKey(/^GITHUB_/)) {
    return {
      adapterId: "github-copilot-cloud-agent",
      confidence: "low",
      reason: "GitHub cloud environment hints are present. CALL-E auth availability still must be verified.",
    };
  }

  return {
    adapterId: "external-cron",
    confidence: "low",
    reason: "No known native client scheduler hints were detected.",
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }

  const detection = detectClient();
  if (args.includes("--plain")) {
    process.stdout.write(`${detection.adapterId}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(detection, null, 2)}\n`);
}

main();
