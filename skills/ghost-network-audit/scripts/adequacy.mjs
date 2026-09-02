// Audit scoring. Methodology and the reasoning behind each denominator are in
// references/adequacy-methodology.md.

const CONFIRMED_STATES = new Set([
  'confirmed_active',
  'confirmed_ghost',
  'confirmed_closed_panel',
]);

function rate(numerator, denominator) {
  // A rate over an empty denominator is not 0, it is undefined. Returning 0 here
  // would print "0% ghosts" for an audit that reached nobody.
  return denominator > 0 ? numerator / denominator : null;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function scoreAudit(rows) {
  const total = rows.length;
  const skipped = rows.filter((row) => row.state === 'skipped').length;
  const deferred = rows.filter((row) => row.state === 'deferred').length;
  const dialable = total - skipped;

  const confirmedRows = rows.filter((row) => CONFIRMED_STATES.has(row.state));
  const confirmed = confirmedRows.length;
  const ghosts = confirmedRows.filter((row) => row.state === 'confirmed_ghost').length;
  const active = confirmedRows.filter((row) => row.state === 'confirmed_active').length;
  const closedPanel = confirmedRows.filter((row) => row.state === 'confirmed_closed_panel').length;
  const unverified = rows.filter((row) => row.state === 'unverified').length;

  const waits = confirmedRows
    .filter((row) => row.state === 'confirmed_active')
    .map((row) => row.next_appointment_weeks)
    .filter((weeks) => typeof weeks === 'number' && Number.isFinite(weeks));

  const activeWithoutWait = active - waits.length;

  return {
    counts: {
      total,
      dialable,
      skipped,
      deferred,
      confirmed,
      unverified,
      confirmed_active: active,
      confirmed_ghost: ghosts,
      confirmed_closed_panel: closedPanel,
      active_without_stated_wait: activeWithoutWait,
    },
    // Coverage is listed first everywhere it is rendered. A ghost rate quoted
    // without the share of listings it was computed over reads as a claim about
    // the whole directory, which it is not.
    coverage: rate(confirmed, dialable),
    ghost_rate: rate(ghosts, confirmed),
    active_rate: rate(active, confirmed),
    closed_panel_rate: rate(closedPanel, confirmed),
    effective_availability: rate(active, confirmed),
    unverified_rate: rate(unverified, dialable),
    median_wait_weeks: median(waits),
    reason_breakdown: rows.reduce((acc, row) => {
      if (!row.reason) return acc;
      const key = `${row.state}:${row.reason}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
}

export function formatPercent(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

// One-paragraph summary that keeps coverage attached to the headline number, so a
// figure cannot be lifted out of the report without its own uncertainty.
export function summarize(score) {
  const { counts } = score;
  if (counts.confirmed === 0) {
    return `No listing produced a confirmed answer across ${counts.dialable} dialable listings. This run says nothing about the directory - it says the audit did not connect. Check the calling window and the line-type gates before running again.`;
  }
  const parts = [
    `Confirmed ${counts.confirmed} of ${counts.dialable} dialable listings (${formatPercent(score.coverage)} coverage).`,
    `Within those confirmed listings: ${formatPercent(score.ghost_rate)} were ghosts, ${formatPercent(score.closed_panel_rate)} had closed panels, and ${formatPercent(score.effective_availability)} were actually usable by a new patient.`,
  ];
  if (score.median_wait_weeks !== null) {
    parts.push(`Median wait among usable listings was ${score.median_wait_weeks} weeks.`);
  }
  parts.push(
    `${counts.unverified} listings could not be resolved and are reported as unverified, not as findings.`,
  );
  return parts.join(' ');
}
