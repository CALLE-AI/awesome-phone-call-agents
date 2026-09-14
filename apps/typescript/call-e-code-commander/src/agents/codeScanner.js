/**
 * Honest static scanner for pasted incident code.
 *
 * The three built-in scenarios ship with authored root causes and patches. When
 * someone pastes their own broken code, fabricating a patch for it would be
 * worse than useless: it would put a confident, wrong diff in front of an
 * engineer during an incident.
 *
 * So this does something smaller and true. It scans for a fixed set of fault
 * patterns, reports the ones it actually finds with real line numbers and the
 * matched text as evidence, and says plainly when it finds nothing. Confidence
 * is reported per rule, because a regex over source text is a heuristic and
 * presenting it as certainty is how tools lose an engineer's trust.
 *
 * What CALL-E then reads out on the phone is what was genuinely found.
 */

/**
 * Rules are ordered by severity. Each `test` receives one line of source and
 * returns a match, and `appliesTo` narrows a rule to relevant file types.
 */
const RULES = [
  {
    id: 'sql-injection',
    cwe: 'CWE-89',
    title: 'SQL built by string interpolation',
    severity: 'critical',
    confidence: 'high',
    detail: 'A query is assembled from interpolated values, so any value that reaches it can change the statement.',
    recommendation: 'Use parameterised queries or a query builder that binds values separately from the statement.',
    // Expressed as three independent conditions rather than one regex. A single
    // pattern has to reason about quotes inside the SQL string, which is where
    // this kind of rule quietly stops matching real vulnerable code.
    test: (line) =>
      /\b(?:query|execute|exec|raw|prepare)\s*\(/i.test(line)
      && /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP)\b/i.test(line)
      && hasInterpolation(line)
  },
  {
    id: 'jwt-decode-without-verify',
    cwe: 'CWE-347',
    title: 'JWT decoded without signature verification',
    severity: 'critical',
    confidence: 'high',
    detail: 'decode() reads the token payload without checking the signature, so the claims inside it are attacker controlled.',
    recommendation: 'Use verify() with an explicit algorithm allowlist and the expected issuer and audience.',
    pattern: /\bjwt\s*\.\s*decode\s*\(/
  },
  {
    id: 'command-injection',
    cwe: 'CWE-78',
    title: 'Shell command built by interpolation',
    severity: 'critical',
    confidence: 'high',
    detail: 'A shell command is assembled from interpolated values, which lets an input inject additional commands.',
    recommendation: 'Use execFile or spawn with an argument array instead of a single interpolated command string.',
    test: (line) => /\b(?:exec|execSync|spawnSync)\s*\(/.test(line) && hasInterpolation(line)
  },
  {
    id: 'dynamic-eval',
    cwe: 'CWE-95',
    title: 'Dynamic code evaluation',
    severity: 'critical',
    confidence: 'high',
    detail: 'eval or the Function constructor executes text as code, so any value reaching it runs with full privileges.',
    recommendation: 'Replace with an explicit parser, a lookup table, or JSON.parse for data.',
    pattern: /\b(?:eval\s*\(|new\s+Function\s*\()/
  },
  {
    id: 'hardcoded-secret',
    cwe: 'CWE-798',
    title: 'Credential hardcoded in source',
    severity: 'critical',
    confidence: 'medium',
    detail: 'A secret appears as a literal in the source, so it is in version control and in every build artifact.',
    recommendation: 'Load it from the environment or a secret manager and rotate the exposed value.',
    pattern: /\b(?:api[_-]?key|secret|password|passwd|token|private[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]/i
  },
  {
    id: 'tls-verification-disabled',
    cwe: 'CWE-295',
    title: 'TLS certificate verification disabled',
    severity: 'high',
    confidence: 'high',
    detail: 'Certificate checking is switched off, which removes the protection against an intercepted connection.',
    recommendation: 'Re-enable verification and install the correct certificate authority bundle instead.',
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/
  },
  {
    id: 'xss-innerhtml',
    cwe: 'CWE-79',
    title: 'Unescaped value written to innerHTML',
    severity: 'high',
    confidence: 'medium',
    detail: 'A dynamic value is written as markup, so text containing tags becomes executable content.',
    recommendation: 'Assign through textContent, or escape the value before it becomes markup.',
    pattern: /\.innerHTML\s*=\s*(?![`'"]\s*[`'"])[^;]*(?:\$\{|\+|\bvar\b|\blet\b|\bconst\b|\w+\s*\))/
  },
  {
    id: 'weak-randomness',
    cwe: 'CWE-338',
    title: 'Predictable randomness used for a secret',
    severity: 'high',
    confidence: 'medium',
    detail: 'Math.random is not cryptographically secure, so values derived from it are predictable.',
    recommendation: 'Use crypto.randomUUID or crypto.randomBytes for tokens, keys, and identifiers.',
    pattern: /(?:token|secret|key|nonce|salt|otp|session|password)\s*[:=][^;\n]*Math\s*\.\s*random\s*\(/i
  },
  {
    id: 'swallowed-error',
    cwe: 'CWE-390',
    title: 'Exception caught and discarded',
    severity: 'medium',
    confidence: 'high',
    detail: 'An empty catch block hides the failure, which is why an incident like this surfaces late.',
    recommendation: 'Log the error with context, or rethrow it if the caller cannot continue safely.',
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/
  },
  {
    id: 'unawaited-promise',
    cwe: 'CWE-362',
    title: 'Promise-returning call is not awaited',
    severity: 'medium',
    confidence: 'low',
    detail: 'The result is discarded, so failures are unhandled and ordering is not guaranteed.',
    recommendation: 'Await the call, or attach an explicit catch if it is intentionally fire-and-forget.',
    pattern: /^\s*(?!(?:return|await|yield)\b)[\w.]*\.(?:save|update|insert|delete|commit|write|send|publish)\s*\([^)]*\)\s*;?\s*$/
  }
];

/** File extensions the JavaScript-shaped rules make sense for. */
const JS_LIKE = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/i;

/**
 * True when a line builds a string from a dynamic value, either by template
 * interpolation or by concatenating a literal with something else.
 */
function hasInterpolation(line) {
  if (/\$\{/.test(line)) return true;
  if (/['"]\s*\+/.test(line) || /\+\s*['"]/.test(line)) return true;
  if (/%s|\?\s*\+|\bformat\s*\(/.test(line)) return true;
  return false;
}

/** Runs one rule against one line, whether it is a pattern or a predicate. */
function ruleMatches(rule, line) {
  return typeof rule.test === 'function' ? rule.test(line) : rule.pattern.test(line);
}

/**
 * Strips string and comment content so a rule does not match on a line that
 * only mentions a pattern inside a comment.
 */
function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('#');
}

/**
 * Detects the read-modify-write shape behind most double-charge and
 * lost-update incidents: a read, then a write to the same thing, in one
 * function, with nothing making the pair atomic.
 *
 * Reported at low confidence because proving it needs the surrounding
 * transaction semantics, which a text scan does not have.
 */
function detectUnguardedReadModifyWrite(lines) {
  const readPattern = /\b(?:findOne|findUnique|findById|SELECT\b|get\s*\()/i;
  const writePattern = /\b(?:update|save|insert|UPDATE\b|INSERT\b|create\s*\()/i;
  const guardPattern = /\b(?:transaction|FOR\s+UPDATE|lock|mutex|SERIALIZABLE|BEGIN\b|acquire)/i;

  const hasGuard = lines.some((line) => guardPattern.test(line));
  if (hasGuard) return null;

  let readLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (readLine === -1 && readPattern.test(lines[i])) {
      readLine = i;
      continue;
    }
    if (readLine !== -1 && writePattern.test(lines[i])) {
      return {
        id: 'unguarded-read-modify-write',
        cwe: 'CWE-362',
        title: 'Read-modify-write with no atomicity guard',
        severity: 'high',
        confidence: 'low',
        line: readLine + 1,
        endLine: i + 1,
        evidence: lines[readLine].trim(),
        detail: `A value is read at line ${readLine + 1} and written at line ${i + 1} with no transaction, row lock, or mutex between them. Two concurrent requests can interleave and both act on the stale read.`,
        recommendation: 'Wrap the pair in a transaction with row-level locking, or make the write conditional on the version that was read.'
      };
    }
  }
  return null;
}

/**
 * Scans pasted source and returns what was actually found.
 *
 * @param {string} source Raw code text.
 * @param {string} fileName Used only to decide which rules apply.
 * @returns {{findings: Array, scannedLines: number, rulesRun: number, clean: boolean}}
 */
export function scanCode(source, fileName = '') {
  const text = typeof source === 'string' ? source : '';
  const lines = text.split('\n');
  const jsLike = !fileName || JS_LIKE.test(fileName);
  const applicable = jsLike ? RULES : RULES.filter((r) => r.id === 'hardcoded-secret' || r.id === 'sql-injection');

  const findings = [];
  const seen = new Set();

  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;

    for (const rule of applicable) {
      if (!ruleMatches(rule, line)) continue;

      // One finding per rule per line, and at most one per rule overall so a
      // repeated pattern does not bury the other findings.
      const key = `${rule.id}:${index}`;
      if (seen.has(key) || seen.has(rule.id)) continue;
      seen.add(key);
      seen.add(rule.id);

      findings.push({
        id: rule.id,
        cwe: rule.cwe,
        title: rule.title,
        severity: rule.severity,
        confidence: rule.confidence,
        line: index + 1,
        evidence: line.trim().slice(0, 160),
        detail: rule.detail,
        recommendation: rule.recommendation
      });
    }
  });

  if (jsLike) {
    const race = detectUnguardedReadModifyWrite(lines);
    if (race) findings.push(race);
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || a.line - b.line);

  return {
    findings,
    scannedLines: lines.length,
    rulesRun: applicable.length + (jsLike ? 1 : 0),
    clean: findings.length === 0
  };
}

/** The finding that should drive the phone call, or null when nothing was found. */
export function primaryFinding(scan) {
  return scan.findings.length > 0 ? scan.findings[0] : null;
}

/**
 * Renders the scan as annotated source for the diff pane.
 *
 * Flagged lines are marked, and an explanatory line is inserted above each one.
 * Nothing is rewritten, because the scanner does not know how to fix the code
 * and should not pretend otherwise.
 */
export function buildAnnotatedDiff(source, scan) {
  const lines = (source || '').split('\n');
  const byLine = new Map();
  scan.findings.forEach((f) => {
    if (!byLine.has(f.line)) byLine.set(f.line, []);
    byLine.get(f.line).push(f);
  });

  const rows = [];
  lines.forEach((line, index) => {
    const hits = byLine.get(index + 1);
    if (hits) {
      hits.forEach((f) => {
        rows.push({ type: 'add', text: `+ ${f.cwe} (${f.confidence} confidence): ${f.title}` });
        rows.push({ type: 'add', text: `+ fix: ${f.recommendation}` });
      });
      rows.push({ type: 'del', text: `- ${line}` });
    } else {
      rows.push({ type: 'normal', text: `  ${line}` });
    }
  });

  if (scan.clean) {
    rows.unshift({ type: 'normal', text: `  No known fault pattern matched across ${scan.scannedLines} lines.` });
    rows.unshift({ type: 'normal', text: `  ${scan.rulesRun} rules ran. This is a pattern scan, not a proof of correctness.` });
  }

  return rows;
}

/** Human summary used for the phone brief and the incident telemetry panel. */
export function describeScan(scan, fileName) {
  if (scan.clean) {
    return `Scanned ${scan.scannedLines} lines of ${fileName} against ${scan.rulesRun} fault patterns and matched none. The failure is not one this scanner recognises, so an engineer needs to look at it directly.`;
  }

  const top = scan.findings[0];
  const others = scan.findings.length - 1;
  const extra = others > 0 ? ` ${others} further ${others === 1 ? 'issue was' : 'issues were'} flagged.` : '';
  return `${top.title} at line ${top.line} of ${fileName}, matching ${top.cwe}, reported at ${top.confidence} confidence.${extra}`;
}
