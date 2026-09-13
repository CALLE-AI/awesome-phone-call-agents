/**
 * Human output. One shape for the terminal, one for `--json`.
 *
 * Findings print with their evidence attached, because a finding a reader cannot
 * check against the script is a finding they have to take on trust.
 */

import { BLOCKING } from "./checks.js";
import type { Finding, PreflightResult, ProviderDescriptor, Script } from "./types.js";

function mask(value: string, keep = 4): string {
  if (value.length <= keep) return "*".repeat(value.length);
  return `${value.slice(0, keep)}${"*".repeat(Math.min(8, value.length - keep))}`;
}

/** Preview contacts nothing, so it reports what would be sent and where. */
export function renderPreview(script: Script, descriptor: ProviderDescriptor): string {
  const url = new URL(descriptor.endpoint.replaceAll("{voice}", script.voiceId));
  const lines = [
    "Preview only. No request is made and no credential is read.",
    "",
    `Script        ${script.id}`,
    `Locale        ${script.locale}`,
    `Provider      ${descriptor.name} (${descriptor.method} ${url.origin}${url.pathname})`,
    `Credential    ${descriptor.authEnv} in header ${descriptor.authHeader}, read at send time`,
    `Voice         ${mask(script.voiceId)}`,
    `Budget        ${script.maxSpokenSeconds}s spoken, ${descriptor.maxChars} characters per request`,
    `Task length   ${script.task.length} characters`,
    "",
    "Locked lines, each must survive verbatim",
  ];
  for (const locked of script.locked) {
    lines.push(`  - ${locked.text}`);
    lines.push(`    because ${locked.reason}`);
  }
  lines.push("", "Add --render to synthesise it and measure the audio.");
  return lines.join("\n");
}

export function renderFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return "No findings.";
  const lines: string[] = [];
  for (const finding of findings) {
    const tag = BLOCKING.has(finding.code) ? "REFUSE" : "report";
    lines.push(`${tag}  ${finding.code}`);
    lines.push(`        ${finding.message}`);
    lines.push(`        evidence: ${finding.evidence}`);
  }
  return lines.join("\n");
}

export function renderResult(result: PreflightResult): string {
  const lines: string[] = [];
  if (result.render === null) {
    lines.push("Nothing was rendered, so the spoken length was not measured.");
  } else {
    const r = result.render;
    const seconds = r.seconds === null ? "not measurable here" : `${r.seconds.toFixed(1)}s`;
    lines.push(
      `Rendered      ${r.provider} voice ${mask(r.voiceId)}, ${r.bytes} bytes, ${seconds}${r.cached ? ", from cache" : ""}`,
    );
    lines.push(`Audio         ${r.path}`);
    if (r.seconds === null) {
      lines.push(
        "              Duration needs a WAV container or ffprobe on the path. The length check was skipped rather than estimated.",
      );
    }
  }
  lines.push("");
  lines.push(renderFindings(result.findings));
  lines.push("");
  lines.push(result.ok ? "Verdict  ok" : "Verdict  refused");
  return lines.join("\n");
}
