#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REQUIRED_ROUTE = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NON_ENGLISH_SCRIPT_RE =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const UNSUPPORTED_BINDING_LEVEL_RE = new RegExp("\\b" + "un" + "bound-" + "generic\\b", "iu");
const UNSUPPORTED_EXECUTION_MODE_RE = new RegExp("\\bper-" + "call-approval\\b", "iu");
const AFFIRMATIVE_PASS_RESULT_RE =
  /^(?:passed|verified|confirmed|completed|succeeded)\b/iu;
const NEGATED_PASS_RESULT_RE =
  /^not[\s_-]+(?:passed|verified|confirmed|completed|succeeded)\b/iu;
const BLOCKING_STATUS_RESULT_RE =
  /\b(?:failed|missing|incomplete|unavailable|not available|unsupported|not run|not ready|not configured|pending|required|blocked|requires|needs?)\b/iu;
const CONTRADICTORY_STATUS_RESULT_RE =
  /\b(?:failed|missing|incomplete|unavailable|not available|unsupported|not run|not ready|not configured|pending|blocked)\b/iu;
const REQUIRED_ACTION_STATUS_RESULT_RE =
  /\b(?:requires|needs?)\b|\b(?:auth(?:entication)?|authorization|oauth|login|setup|configuration|action)\s+required\b|\brequired\s+(?:before|to)\b/iu;
const NO_REQUIRED_ACTION_STATUS_RESULT_RE =
  /\bno\s+(?:(?:extra|additional|separate|source|provider|route|mcp|connector|host|local|managed)\s+)*(?:auth(?:entication)?|authorization|oauth|login|setup|configuration|action)\s+(?:is\s+)?required\b|\b(?:(?:source|provider|route|mcp|connector|host|local|managed)\s+)*(?:auth(?:entication)?|authorization|oauth|login|setup|configuration|action)\s+(?:is\s+)?not\s+required\b|\bno\s+need\s+(?:for|to)\b/giu;
const BLOCKING_EVIDENCE_RESULT_RE =
  /\b(?:failed|missing|incomplete|unavailable|not available|unsupported|not run|not ready|not configured|pending|blocked)\b/iu;
const EMPTY_EVIDENCE_RESULT_RE = /^(?:none|n\/a|na|not applicable|no)[.;]*$/iu;
const NO_EXTRA_EVIDENCE_REQUIRED_RE =
  /^no\s+(?:extra|additional|separate)\b.*\b(?:needed|required)\b/iu;
const NO_EVIDENCE_RESULT_RE =
  /^no\b(?=.*\b(?:route|mapping|tools?|capability|runtime|provider|source|goal)\b)|^no\b(?=.*\bsample\b(?!\s+summar))/iu;
const BINDING_LEVEL_RE =
  /^\s*(?:[-*]\s*)?(?:selected\s+)?binding level\s*(?:is|:)\s*`?(fully-bound|parameterized-bound)`?/imu;
const EXECUTION_MODE_RE =
  /^\s*(?:[-*]\s*)?(?:selected\s+)?execution mode\s*(?:is|:)\s*`?(dry-run-then-batch-approval|approved-direct-execution)`?/imu;
const AFFIRMATIVE_DRY_RUN_ONLY_DECLARATION_RE = /\bdry[-\s]?run[-\s]?only\b/iu;
const NEGATED_DRY_RUN_ONLY_RE = /\bnot[\s_-]+dry[-\s_]?run[-\s_]?only\b/iu;
const BLOCKER_SPECIFIC_DRY_RUN_ONLY_CONTEXT_RE =
  /\b(?:onboarding|blockers?|blocked|source|provider|auth|authentication|credentials?|route|setup)\b/iu;
const PROVIDER_EVIDENCE_LINE_RE =
  /(?:(?:provider\s+)?host runtime|provider_host_runtime|mcp route setup check result|provider route setup check result|mcp_route_setup_check|provider route|provider_route|provider (?:authentication|auth readiness) check result|provider auth(?:entication)?|auth_readiness|compatible MCP provider tools|compatible provider tools|compatible_tools|one[- ]off call capability|one_off_call_capability)\s*:(.*)$/iu;
const DISALLOWED_PROVIDER_EVIDENCE_RE = /inferred|mcp__codex_apps__|call_e_zhiwen|botlab/iu;
const PROVIDER_POLICY_PROSE_RE =
  /\b(?:do not|must not|never|not|not evidence|not proof|does not prove|do not treat|not inferred)\b.*\b(?:inferred?|evidence|proof|prove|treat)\b/iu;
const MARKDOWN_LIST_ITEM_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/u;
const FIELD_LABEL_LINE_RE =
  /^\s*(?:(?:[-*+]\s+|\d+[.)]\s+))?[A-Za-z][A-Za-z0-9 _/-]{1,80}\s*:/u;
const REQUIRED_SKILL_MARKERS = [
  {
    label: "purpose and when to use",
    patterns: [/purpose and when to use/iu, /when to use/iu],
  },
  {
    label: "when not to use",
    patterns: [/when not to use/iu, /do not use/iu],
  },
  {
    label: "binding level and runtime parameters",
    patterns: [/binding level/iu, /runtime parameters/iu],
  },
  {
    label: "source contract",
    patterns: [/source contract/iu],
  },
  {
    label: "candidate fields",
    patterns: [/candidate fields/iu],
  },
  {
    label: "outbound goal contract",
    patterns: [/outbound goal contract/iu],
  },
  {
    label: "MCP provider route",
    patterns: [/mcp provider route/iu],
  },
  {
    label: "provider onboarding",
    patterns: [/provider onboarding/iu],
  },
  {
    label: "execution modes",
    patterns: [/execution modes/iu],
  },
  {
    label: "serial candidate execution",
    patterns: [/serial candidate execution/iu, /serially process all ready candidates/iu],
  },
  {
    label: "provider terminal instruction scope",
    patterns: [
      /provider terminal instructions such as `?report_result`? or `?do not start another call`?\s+apply only to the current provider run/iu,
      /provider terminal instruction[\s\S]*current provider run/iu,
    ],
  },
  {
    label: "post-approval batch autonomy",
    patterns: [
      /after execution approval,\s*do not ask the\s+user to continue,\s*confirm the next candidate,\s*or approve additional provider runs/iu,
      /do not ask the\s+user to continue,\s*confirm the next candidate,\s*or approve additional provider runs/iu,
    ],
  },
  {
    label: "provider result finalization",
    patterns: [
      /provider result finalization[\s\S]*full-history provider\s+reconciliation[\s\S]*negative terminal stability check/iu,
      /terminal provider status is\s+not result-output-ready[\s\S]*full-history provider\s+reconciliation/iu,
    ],
  },
  {
    label: "result-output behavior",
    patterns: [/result-output behavior/iu, /result output behavior/iu],
  },
  {
    label: "result target mode",
    patterns: [
      /result target mode\s*:\s*(?:resolved|fixed|runtime|parameterized|source-writeback|source-adjacent-result-artifact|source-csv-in-place|result-csv-file|session-table|local-result-csv|session-table-fallback)/iu,
      /output target mode\s*:\s*(?:resolved|fixed|runtime|parameterized|source-writeback|source-adjacent-result-artifact|source-csv-in-place|result-csv-file|session-table|local-result-csv|session-table-fallback)/iu,
      /target mode\s*:\s*(?:source-writeback|source-adjacent-result-artifact|source-csv-in-place|result-csv-file|session-table|local-result-csv|session-table-fallback)/iu,
    ],
  },
  {
    label: "durable result output fallback",
    patterns: [
      /result-csv-file[\s\S]*(?:last-resort|session-table)/iu,
      /durable result output[\s\S]*session-table/iu,
    ],
  },
  {
    label: "preflight and creation summary",
    patterns: [/preflight and creation summary/iu],
  },
  {
    label: "safety summary",
    patterns: [/safety summary/iu],
  },
  {
    label: "validation commands",
    patterns: [/validation commands/iu],
  },
];
const BOUND_SOURCE_STATUS_MARKERS = [
  {
    label: "passed authentication or access check result",
    patterns: [
      /^\s*(?:source\s+)?authentication or access check result\s*:\s*([^\n]*)/imu,
      /^\s*(?:source\s+)?auth(?:entication)? check result\s*:\s*([^\n]*)/imu,
      /^\s*auth_or_access_check\s*:\s*([^\n]*)/imu,
    ],
    resultLine: true,
  },
  {
    label: "passed sample fetch result",
    patterns: [
      /^\s*sample fetch result\s*:\s*([^\n]*)/imu,
      /^\s*sample_fetch\s*:\s*([^\n]*)/imu,
    ],
    resultLine: true,
  },
];
const BOUND_SOURCE_ALWAYS_MARKERS = [
  {
    label: "source access route",
    patterns: [
      /^\s*(?:source\s+)?access route\s*:\s*([^\n]*)/imu,
      /^\s*(?:source_)?access_route\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  {
    label: "source access route discovery result",
    patterns: [
      /^\s*source access route discovery result\s*:\s*([^\n]*)/imu,
      /^\s*source_access_route_discovery_result\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  ...BOUND_SOURCE_STATUS_MARKERS,
  {
    label: "redaction policy for sample summaries",
    patterns: [
      /^\s*redaction policy(?: for sample summaries)?\s*:\s*([^\n]*)/imu,
      /^\s*redaction_policy_for_sample_summaries\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  {
    label: "runtime parameters still allowed",
    patterns: [
      /^\s*runtime parameters still allowed\s*:\s*([^\n]*)/imu,
      /^\s*runtime_parameters_still_allowed\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
    allowNone: true,
  },
];
const BOUND_SOURCE_READY_MARKERS = [
  {
    label: "sampled source instance",
    patterns: [
      /^\s*sampled source instance\s*:\s*([^\n]*)/imu,
      /^\s*sampled_source_instance\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  {
    label: "discovered field mapping",
    patterns: [
      /^\s*discovered field mapping\s*:\s*([^\n]*)/imu,
      /^\s*(?:discovered_)?field_mapping\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  {
    label: "user-confirmed field mapping",
    patterns: [
      /^\s*user-confirmed field mapping\s*:\s*([^\n]*)/imu,
      /^\s*user_confirmed_field_mapping\s*:\s*([^\n]*)/imu,
      /field mapping confirmed after (?:the )?(?:representative )?sample/iu,
    ],
    evidenceLine: true,
  },
  {
    label: "default goal contract derived from sampled fields",
    patterns: [
      /^\s*default goal contract derived from sampled fields\s*:\s*([^\n]*)/imu,
      /^\s*default_goal_source\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
];
const BOUND_PROVIDER_STATUS_MARKERS = [
  {
    label: "passed MCP route setup check result",
    patterns: [
      /mcp route setup check result\s*:\s*([^\n]*)/iu,
      /provider route setup check result\s*:\s*([^\n]*)/iu,
      /^\s*mcp_route_setup_check\s*:\s*([^\n]*)/imu,
    ],
    resultLine: true,
  },
  {
    label: "passed provider authentication or auth readiness check result",
    patterns: [
      /provider (?:authentication|auth readiness) check result\s*:\s*([^\n]*)/iu,
      /provider auth(?:entication)?\s*:\s*([^\n]*)/iu,
      /^\s*auth_readiness\s*:\s*([^\n]*)/imu,
    ],
    resultLine: true,
  },
];
const BOUND_PROVIDER_ALWAYS_MARKERS = [
  {
    label: "configured provider host runtime",
    patterns: [
      /provider host runtime\s*:\s*([^\n]*)/iu,
      /host runtime\s*:\s*([^\n]*)/iu,
      /^\s*provider_host_runtime\s*:\s*([^\n]*)/imu,
    ],
    evidenceLine: true,
  },
  ...BOUND_PROVIDER_STATUS_MARKERS,
];
const BOUND_PROVIDER_ONE_OFF_CAPABILITY_MARKER = {
  label: "one-off call capability",
  patterns: [
    /one[- ]off call capability\s*:\s*([^\n]*)/iu,
    /^\s*one_off_call_capability\s*:\s*([^\n]*)/imu,
  ],
  resultLine: true,
};
const BOUND_PROVIDER_COMPATIBLE_TOOLS_MARKER = {
  label: "compatible MCP provider tools",
  patterns: [
    /compatible MCP provider tools\s*:\s*([^\n]*)/iu,
    /compatible provider tools\s*:\s*([^\n]*)/iu,
    /^\s*compatible_tools\s*:\s*([^\n]*)/imu,
  ],
  evidenceLine: true,
  requireConcreteEvidence: true,
  concreteEvidencePattern:
    /\b(?:plan[_ -]?call|run[_ -]?call|get[_ -]?call[_ -]?run|get[_ -]?run|status[_ -]?check|call[_ -]?status)\b/iu,
};
const BOUND_PROVIDER_READY_MARKERS = [
  BOUND_PROVIDER_COMPATIBLE_TOOLS_MARKER,
  BOUND_PROVIDER_ONE_OFF_CAPABILITY_MARKER,
];
const BOUND_PROVIDER_BLOCKING_STATUS_MARKERS = [
  ...BOUND_PROVIDER_STATUS_MARKERS,
  BOUND_PROVIDER_COMPATIBLE_TOOLS_MARKER,
  BOUND_PROVIDER_ONE_OFF_CAPABILITY_MARKER,
];
const PROVIDER_BLOCKER_PATTERNS = [
  /^\s*provider onboarding blocker\s*:\s*([^\n]*)/imu,
  /^\s*provider_onboarding_blocker\s*:\s*([^\n]*)/imu,
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing file: ${filePath}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseFrontmatter(text, filePath) {
  if (!text.startsWith("---\n")) {
    fail(`Missing YAML frontmatter: ${filePath}`);
    return {};
  }

  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    fail(`Unterminated YAML frontmatter: ${filePath}`);
    return {};
  }

  const result = {};
  const block = text.slice(4, end).trim();
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      fail(`Invalid frontmatter line in ${filePath}: ${line}`);
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^[\u2019'"]|[\u2019'"]$/g, "");
    result[key] = value;
  }
  return result;
}

function walkTextFiles(dirPath) {
  const files = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTextFiles(fullPath));
      continue;
    }
    if (/\.(md|mjs|json|yaml|yml|txt)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseArgs(argv) {
  const args = { skillDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skill-dir") {
      args.skillDir = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

function extractRequiredValue(text, pattern, label) {
  const match = pattern.exec(text);
  if (!match) {
    fail(`Generated skill SKILL.md must declare a selected ${label}`);
    return "";
  }
  return match[1].toLowerCase();
}

function extractSection(text, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\r?\\n)##[ \\t]+${escapedHeading}[ \\t]*(?:\\r?\\n|$)` +
      `([\\s\\S]*?)(?=\\r?\\n##[ \\t]+|$)`,
    "iu",
  );
  const match = pattern.exec(text);
  return match ? match[1] : "";
}

function extractAllSections(text, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\r?\\n)##[ \\t]+${escapedHeading}[ \\t]*(?:\\r?\\n|$)` +
      `([\\s\\S]*?)(?=\\r?\\n##[ \\t]+|$)`,
    "igu",
  );
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function extractSections(text, headings) {
  const sectionTexts = [];
  for (const heading of headings) {
    for (const sectionText of extractAllSections(text, heading)) {
      if (sectionText.trim()) {
        sectionTexts.push(sectionText);
      }
    }
  }
  return sectionTexts.join("\n");
}

function getDryRunOnlyDeclarationState(textSegments) {
  let hasAffirmativeDeclaration = false;
  let hasNegatedDeclaration = false;
  for (const textSegment of textSegments) {
    for (const line of textSegment.split(/\r?\n/u)) {
      if (NEGATED_DRY_RUN_ONLY_RE.test(line)) {
        hasNegatedDeclaration = true;
        continue;
      }
      if (
        AFFIRMATIVE_DRY_RUN_ONLY_DECLARATION_RE.test(line) &&
        BLOCKER_SPECIFIC_DRY_RUN_ONLY_CONTEXT_RE.test(line)
      ) {
        hasAffirmativeDeclaration = true;
      }
    }
  }
  return { hasAffirmativeDeclaration, hasNegatedDeclaration };
}

function withGlobalFlag(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function findPatternMatches(text, pattern) {
  return text.matchAll(withGlobalFlag(pattern));
}

function classifyOnboardingStatusLine(statusLine, allowBlockedStatus) {
  const normalizedStatusLine = statusLine.trim();
  const normalizedBlockingStatusLine = normalizedStatusLine.replace(/[_-]+/gu, " ");
  if (/\bplaceholder\b/iu.test(normalizedStatusLine)) {
    return "";
  }
  if (AFFIRMATIVE_PASS_RESULT_RE.test(normalizedStatusLine)) {
    const actionableStatusLine = normalizedBlockingStatusLine.replace(
      NO_REQUIRED_ACTION_STATUS_RESULT_RE,
      " ",
    );
    if (
      CONTRADICTORY_STATUS_RESULT_RE.test(normalizedBlockingStatusLine) ||
      REQUIRED_ACTION_STATUS_RESULT_RE.test(actionableStatusLine)
    ) {
      return "conflicted";
    }
    return "passed";
  }
  if (
    allowBlockedStatus &&
    (NEGATED_PASS_RESULT_RE.test(normalizedStatusLine) ||
      BLOCKING_STATUS_RESULT_RE.test(normalizedBlockingStatusLine))
  ) {
    return "blocked";
  }
  return "";
}

function classifyEvidenceValueLine(evidenceValue, allowBlockedStatus, marker = {}) {
  const normalizedEvidenceValue = evidenceValue.trim();
  const normalizedBlockingEvidenceValue = normalizedEvidenceValue.replace(/[_-]+/gu, " ");
  if (!normalizedEvidenceValue || /\bplaceholder\b/iu.test(normalizedEvidenceValue)) {
    return "";
  }
  if (
    marker.requireConcreteEvidence &&
    !marker.concreteEvidencePattern?.test(normalizedEvidenceValue)
  ) {
    return allowBlockedStatus ? "blocked" : "";
  }
  if (
    !marker.allowNone &&
    !NO_EXTRA_EVIDENCE_REQUIRED_RE.test(normalizedEvidenceValue) &&
    (EMPTY_EVIDENCE_RESULT_RE.test(normalizedEvidenceValue) ||
      NO_EVIDENCE_RESULT_RE.test(normalizedEvidenceValue))
  ) {
    return allowBlockedStatus ? "blocked" : "";
  }
  if (
    NEGATED_PASS_RESULT_RE.test(normalizedEvidenceValue) ||
    BLOCKING_EVIDENCE_RESULT_RE.test(normalizedBlockingEvidenceValue)
  ) {
    return allowBlockedStatus ? "blocked" : "";
  }
  return "passed";
}

function classifyMarkerMatch(marker, match, allowBlockedStatus) {
  if (marker.resultLine) {
    return classifyOnboardingStatusLine(match[1] || "", allowBlockedStatus);
  }
  if (marker.evidenceLine) {
    if (match.length < 2) {
      return "passed";
    }
    return classifyEvidenceValueLine(match[1] || "", allowBlockedStatus, marker);
  }
  return "";
}

function getOnboardingStatus(text, marker, allowBlockedStatus) {
  if (!marker.resultLine && !marker.evidenceLine) {
    return "";
  }
  let seenPassedStatus = false;
  let seenBlockedStatus = false;
  for (const pattern of marker.patterns) {
    for (const match of findPatternMatches(text, pattern)) {
      const status = classifyMarkerMatch(marker, match, allowBlockedStatus);
      if (status === "passed") {
        seenPassedStatus = true;
      }
      if (status === "blocked") {
        seenBlockedStatus = true;
      }
      if (status === "conflicted") {
        fail(`Generated skill SKILL.md has contradictory ${marker.label} line`);
        return "";
      }
    }
  }
  if (seenPassedStatus && seenBlockedStatus) {
    fail(`Generated skill SKILL.md has conflicting ${marker.label} lines`);
    return "";
  }
  if (seenPassedStatus) {
    return "passed";
  }
  if (seenBlockedStatus) {
    return "blocked";
  }
  return "";
}

function hasAcceptedOnboardingStatusLine(text, statusLinePattern, allowBlockedStatus) {
  for (const match of findPatternMatches(text, statusLinePattern)) {
    if (classifyOnboardingStatusLine(match[1] || "", allowBlockedStatus)) {
      return true;
    }
  }
  return false;
}

function hasAcceptedEvidenceLine(text, marker, evidenceLinePattern, allowBlockedStatus) {
  for (const match of findPatternMatches(text, evidenceLinePattern)) {
    if (classifyMarkerMatch(marker, match, allowBlockedStatus)) {
      return true;
    }
  }
  return false;
}

function hasMarkerWithAllowedStatus(text, marker, allowBlockedStatus) {
  for (const pattern of marker.patterns) {
    if (marker.resultLine) {
      if (hasAcceptedOnboardingStatusLine(text, pattern, allowBlockedStatus)) {
        return true;
      }
      continue;
    }
    if (marker.evidenceLine) {
      if (hasAcceptedEvidenceLine(text, marker, pattern, allowBlockedStatus)) {
        return true;
      }
      continue;
    }
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

function failOnConflictingStatusLines(text, markers) {
  for (const marker of markers) {
    getOnboardingStatus(text, marker, true);
  }
}

function requireMarkerGroup(text, markers, allowBlockedStatus, messagePrefix) {
  for (const marker of markers) {
    if (!hasMarkerWithAllowedStatus(text, marker, allowBlockedStatus)) {
      fail(`${messagePrefix} ${marker.label}`);
    }
  }
}

function validateBoundSourceOnboarding(sourceOnboardingText) {
  failOnConflictingStatusLines(sourceOnboardingText, [
    ...BOUND_SOURCE_ALWAYS_MARKERS,
    ...BOUND_SOURCE_READY_MARKERS,
  ]);
  requireMarkerGroup(
    sourceOnboardingText,
    BOUND_SOURCE_ALWAYS_MARKERS,
    false,
    "Bound generated skill SKILL.md must include",
  );
  requireMarkerGroup(
    sourceOnboardingText,
    BOUND_SOURCE_READY_MARKERS,
    false,
    "Bound generated skill SKILL.md must include",
  );
}

function validateBoundProviderOnboarding(providerOnboardingText, allowsBlockedOnboarding) {
  failOnConflictingStatusLines(providerOnboardingText, [
    ...BOUND_PROVIDER_ALWAYS_MARKERS,
    ...BOUND_PROVIDER_READY_MARKERS,
  ]);
  const providerOnboardingStatuses = BOUND_PROVIDER_BLOCKING_STATUS_MARKERS.map((marker) =>
    getOnboardingStatus(providerOnboardingText, marker, allowsBlockedOnboarding),
  );
  const hasBlockedProviderOnboarding = providerOnboardingStatuses.includes("blocked");
  requireMarkerGroup(
    providerOnboardingText,
    BOUND_PROVIDER_ALWAYS_MARKERS,
    allowsBlockedOnboarding,
    "Bound generated skill SKILL.md must include",
  );
  if (hasBlockedProviderOnboarding) {
    if (!hasNonEmptyBlocker(providerOnboardingText, PROVIDER_BLOCKER_PATTERNS)) {
      fail(
        "Dry-run-only blocked provider onboarding must include a non-empty provider onboarding blocker",
      );
    }
    const passedReadyMarker = BOUND_PROVIDER_READY_MARKERS.find(
      (marker) => getOnboardingStatus(providerOnboardingText, marker, true) === "passed",
    );
    if (passedReadyMarker) {
      fail(
        `Dry-run-only blocked provider onboarding must not include passed ${passedReadyMarker.label}`,
      );
    }
    return;
  }
  requireMarkerGroup(
    providerOnboardingText,
    BOUND_PROVIDER_READY_MARKERS,
    allowsBlockedOnboarding,
    "Bound generated skill SKILL.md must include",
  );
}

function hasNonEmptyBlocker(text, blockerPatterns) {
  let hasUsableBlocker = false;
  for (const pattern of blockerPatterns) {
    for (const match of findPatternMatches(text, pattern)) {
      const blockerValue = (match[1] || "").trim().replace(/[.;]+$/u, "").trim();
      if (!blockerValue) {
        return false;
      }
      if (/^(?:none|n\/a|na|not applicable|no blockers?)$/iu.test(blockerValue)) {
        return false;
      }
      hasUsableBlocker = true;
    }
  }
  return hasUsableBlocker;
}

function hasDisallowedProviderEvidence(text, { scanFreeFormEvidence = false } = {}) {
  const lines = text.split(/\r?\n/u);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (scanFreeFormEvidence && hasDisallowedFreeFormProviderEvidence(lines, lineIndex)) {
      return true;
    }
    const providerEvidenceMatch = PROVIDER_EVIDENCE_LINE_RE.exec(line);
    if (!providerEvidenceMatch) {
      continue;
    }
    if (DISALLOWED_PROVIDER_EVIDENCE_RE.test(line)) {
      return true;
    }
    const hasSameLineValue = Boolean((providerEvidenceMatch[1] || "").trim());
    for (
      let continuationIndex = lineIndex + 1;
      continuationIndex < lines.length;
      continuationIndex += 1
    ) {
      const continuationLine = lines[continuationIndex];
      if (
        isNestedProviderEvidenceContinuationLine(continuationLine) &&
        DISALLOWED_PROVIDER_EVIDENCE_RE.test(continuationLine)
      ) {
        return true;
      }
      if (!isProviderEvidenceContinuationLine(continuationLine, hasSameLineValue)) {
        break;
      }
      if (DISALLOWED_PROVIDER_EVIDENCE_RE.test(continuationLine)) {
        return true;
      }
    }
  }
  return false;
}

function hasDisallowedFreeFormProviderEvidence(lines, lineIndex) {
  const line = lines[lineIndex];
  if (!DISALLOWED_PROVIDER_EVIDENCE_RE.test(line)) {
    return false;
  }
  const lineWithContinuation = getFreeFormProviderEvidenceContext(lines, lineIndex);
  return (
    DISALLOWED_PROVIDER_EVIDENCE_RE.test(lineWithContinuation) &&
    !PROVIDER_POLICY_PROSE_RE.test(lineWithContinuation)
  );
}

function getFreeFormProviderEvidenceContext(lines, lineIndex) {
  let context = lines[lineIndex];
  for (
    let continuationIndex = lineIndex + 1;
    continuationIndex < lines.length;
    continuationIndex += 1
  ) {
    const continuationLine = lines[continuationIndex];
    if (!isFreeFormPolicyContinuationLine(continuationLine, context)) {
      break;
    }
    context = `${context.trimEnd()} ${continuationLine.trim()}`;
  }
  return context;
}

function isFreeFormPolicyContinuationLine(line, previousText) {
  if (!line.trim()) {
    return false;
  }
  if (/^\s*#{1,6}\s/u.test(line)) {
    return false;
  }
  if (
    PROVIDER_EVIDENCE_LINE_RE.test(line) ||
    FIELD_LABEL_LINE_RE.test(line) ||
    MARKDOWN_LIST_ITEM_RE.test(line)
  ) {
    return false;
  }
  return !/[.!?]\s*$/u.test(previousText.trim());
}

function isProviderEvidenceContinuationLine(line, previousLineHasValue) {
  if (!line.trim()) {
    return false;
  }
  if (/^\s*#{1,6}\s/u.test(line)) {
    return false;
  }
  if (isNestedProviderEvidenceContinuationLine(line)) {
    return true;
  }
  if (PROVIDER_EVIDENCE_LINE_RE.test(line) || FIELD_LABEL_LINE_RE.test(line)) {
    return false;
  }
  if (!previousLineHasValue) {
    return true;
  }
  return (
    /^[a-z`"'([{]/u.test(line.trim()) ||
    DISALLOWED_PROVIDER_EVIDENCE_RE.test(line)
  );
}

function isNestedProviderEvidenceContinuationLine(line) {
  return MARKDOWN_LIST_ITEM_RE.test(line) || /^\s{2,}\S/u.test(line);
}

const args = parseArgs(process.argv.slice(2));
if (!args.skillDir) {
  fail("Usage: check-generated-skill.mjs --skill-dir <path>");
  process.exit();
}

const skillDir = path.resolve(args.skillDir);
const skillName = path.basename(skillDir);
const skillMd = path.join(skillDir, "SKILL.md");
const safetyMd = path.join(skillDir, "references", "safety.md");
const examplesMd = path.join(skillDir, "references", "examples.md");

if (!SLUG_RE.test(skillName)) {
  fail(`Skill directory is not a lowercase slug: ${skillName}`);
}

const skillText = readText(skillMd);
const frontmatter = parseFrontmatter(skillText, skillMd);
const frontmatterKeys = Object.keys(frontmatter);

if (
  frontmatterKeys.some((key) => !["name", "description"].includes(key)) ||
  !frontmatterKeys.includes("name") ||
  !frontmatterKeys.includes("description")
) {
  fail("Generated skill frontmatter must include only name and description");
}

if (frontmatter.name !== skillName) {
  fail(`Skill name '${frontmatter.name || ""}' must match directory '${skillName}'`);
}

if (!frontmatter.description || frontmatter.description.length < 40) {
  fail("Skill description must be at least 40 characters");
}

if (!/phone|call/iu.test(frontmatter.description || "")) {
  fail("Skill description must mention phone or call workflow");
}

for (const marker of REQUIRED_SKILL_MARKERS) {
  if (!marker.patterns.some((pattern) => pattern.test(skillText))) {
    fail(`Generated skill SKILL.md must include ${marker.label}`);
  }
}

if (!/source onboarding/iu.test(skillText)) {
  fail("Generated skill SKILL.md must include source onboarding");
}

const bindingLevelText = extractSection(skillText, "Binding Level and Runtime Parameters");
const sourceOnboardingText = extractSections(skillText, [
  "Source Onboarding",
  "Source Onboarding Contract",
]);
const providerOnboardingText = extractSections(skillText, [
  "Provider Onboarding",
  "Provider Onboarding Contract",
]);
const executionModesText = extractSection(skillText, "Execution Modes");
const safetySummaryText = extractSection(skillText, "Safety Summary");
const selectedBindingLevel = extractRequiredValue(
  bindingLevelText,
  BINDING_LEVEL_RE,
  "binding level",
);
const selectedExecutionMode = extractRequiredValue(
  executionModesText,
  EXECUTION_MODE_RE,
  "execution mode",
);
const dryRunOnlyDeclarationState = getDryRunOnlyDeclarationState([
  executionModesText,
  sourceOnboardingText,
  providerOnboardingText,
  safetySummaryText,
]);
const allowsBlockedOnboarding =
  selectedExecutionMode === "dry-run-then-batch-approval" &&
  dryRunOnlyDeclarationState.hasAffirmativeDeclaration &&
  !dryRunOnlyDeclarationState.hasNegatedDeclaration;

if (["fully-bound", "parameterized-bound"].includes(selectedBindingLevel)) {
  validateBoundSourceOnboarding(sourceOnboardingText);
  if (
    hasDisallowedProviderEvidence(providerOnboardingText, {
      scanFreeFormEvidence: true,
    })
  ) {
    fail(
      "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools",
    );
  }
  validateBoundProviderOnboarding(providerOnboardingText, allowsBlockedOnboarding);
}

if (!/runtime gate/iu.test(skillText)) {
  fail("Generated skill SKILL.md must mention runtime gate requirements");
}

if (
  !skillText.includes("must not use a CLI bootstrap path") &&
  !skillText.includes("Do not use a CLI bootstrap path")
) {
  fail(
    "Generated skill SKILL.md must explicitly say it must not use a CLI bootstrap path",
  );
}

readText(safetyMd);
readText(examplesMd);

if (fs.existsSync(path.join(skillDir, "template.md"))) {
  fail("Generated outbound skills must not use template.md");
}

const textFiles = fs.existsSync(skillDir) ? walkTextFiles(skillDir) : [];
const allText = textFiles.map((filePath) => readText(filePath)).join("\n");

if (UNSUPPORTED_BINDING_LEVEL_RE.test(allText)) {
  fail(
    "Generated skill files must use fully-bound or parameterized-bound; unsupported binding levels are not allowed",
  );
}

if (UNSUPPORTED_EXECUTION_MODE_RE.test(allText)) {
  fail(
    "Generated skill files must use dry-run-then-batch-approval or approved-direct-execution; unsupported execution modes are not allowed",
  );
}

if (!allText.includes(REQUIRED_ROUTE)) {
  fail(`Generated skill must mention MCP provider route ${REQUIRED_ROUTE}`);
}

for (const filePath of textFiles) {
  const text = readText(filePath);
  if (NON_ENGLISH_SCRIPT_RE.test(text)) {
    fail(`Non-English CJK, Japanese, or Korean script found in generated skill file: ${filePath}`);
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(`Generated skill validation passed: ${skillDir}`);
