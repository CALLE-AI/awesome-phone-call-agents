/* Muster console - rendering.
   Every function here takes data already loaded by app.data.js and returns or
   writes markup. No fetching, no routing. */

var Muster = window.Muster || {};
window.Muster = Muster;

Muster.LOG_TOP = 20000;

Muster.logPct = function (value) {
  var v = Math.max(Number(value) || 1, 1);
  return (Math.log(v) / Math.log(Muster.LOG_TOP)) * 100;
};

/* ------------------------------------------------------------------- KPIs */

Muster.renderKpis = function () {
  var host = document.getElementById('kpis');
  if (!host) { return; }
  var subjects = Muster.subjects();
  var tally = Muster.tallies();
  var confirmed = tally.byGrade.CONFIRMED_LIVE || 0;
  var open = Muster.caseSubjects().length;
  var exposure = Muster.state.exposure;
  var worst = exposure ? (exposure.interval_days + exposure.ladder_days) : null;

  var cells = [
    {
      label: 'Subjects',
      value: subjects.length,
      foot: 'Enrolled on this scheme. Enrolment is a human act, out of band.'
    },
    {
      label: 'Confirmed this cycle',
      value: confirmed,
      foot: confirmed + ' of ' + subjects.length + ' closed without a person. Every other line stays open.'
    },
    {
      label: 'Open cases',
      value: open,
      foot: 'Waiting on a person. None of them stops a payment.'
    },
    {
      label: 'Worst-case exposure',
      value: worst === null ? '--' : worst,
      foot: worst === null
        ? 'Exposure model unavailable.'
        : 'Days. One ' + exposure.interval_days + '-day interval plus ' +
          exposure.ladder_days + ' days of escalation to a person.'
    }
  ];

  host.innerHTML = cells.map(function (c) {
    return '<div class="kpi">' +
      '<p class="kpi-label">' + Muster.escape(c.label) + '</p>' +
      '<p class="kpi-value num">' + Muster.escape(c.value) + '</p>' +
      '<p class="kpi-foot">' + Muster.escape(c.foot) + '</p>' +
      '</div>';
  }).join('');
};

/* ------------------------------------------------------------------ chart */

Muster.chartMarkup = function (exposure) {
  if (!exposure) {
    return '<p class="loading">The exposure model could not be loaded.</p>';
  }

  var ticks = [1, 10, 100, 1000, 10000];

  var gridlines = ticks.map(function (t) {
    return '<span class="gridline" style="left:' + Muster.logPct(t).toFixed(2) + '%"></span>';
  }).join('');

  var axis = '<div class="axis">' + ticks.map(function (t) {
    var pct = Muster.logPct(t);
    var style = pct < 1
      ? 'left:0;transform:none'
      : 'left:' + pct.toFixed(2) + '%';
    return '<span class="axis-tick" style="' + style + '">' + Muster.commas(t) + '</span>';
  }).join('') + '</div>';

  var rows = exposure.cases.map(function (c) {
    return '<div class="chart-row">' +
      '<div class="chart-row-head">' +
        '<div>' +
          '<span class="chart-row-title">' + Muster.escape(c.title) + '</span>' +
          '<span class="chart-row-meta"> died ' + Muster.escape(c.died) +
            ', detected ' + Muster.escape(c.detected) + '</span>' +
        '</div>' +
        '<p class="chart-factor">' + Muster.escape(c.reduction_factor) + 'x' +
          '<small>shorter under this cadence</small></p>' +
      '</div>' +
      '<div class="track">' +
        gridlines +
        '<div class="bar-row">' +
          '<span class="bar actual" style="width:' + Muster.logPct(c.actual_days).toFixed(2) + '%">' +
            Muster.commas(c.actual_days) + '</span>' +
          '<span class="bar-caption">days undetected, as recorded</span>' +
        '</div>' +
        '<div class="bar-row">' +
          '<span class="bar modelled" style="width:' + Muster.logPct(c.modelled_days).toFixed(2) + '%">' +
            Muster.commas(c.modelled_days) + '</span>' +
          '<span class="bar-caption">days, modelled worst case under this cadence</span>' +
        '</div>' +
        axis +
      '</div>' +
      '</div>';
  }).join('');

  return '<div class="chart-legend">' +
      '<span><i class="swatch actual"></i>Actual, undetected</span>' +
      '<span><i class="swatch modelled"></i>Modelled, under this cadence</span>' +
    '</div>' +
    '<div class="chart-scroll"><div class="chart-inner">' + rows + '</div></div>' +
    '<p class="axis-note">Horizontal axis is logarithmic, in days, because the two ' +
    'quantities differ by more than two orders of magnitude. Both bars are labelled ' +
    'with their real value.</p>';
};

Muster.renderExposureChart = function () {
  var host = document.getElementById('exposure-chart');
  if (host) { host.innerHTML = Muster.chartMarkup(Muster.state.exposure); }
};

/* --------------------------------------------------------------- register */

Muster.registerRow = function (row) {
  var s = row.subject;
  var a = row.attestation;
  var due = a && a.next_due ? Muster.formatDate(a.next_due) : null;

  var step = '<span class="chip plain">Not yet run</span>';
  if (a) {
    if (!a.next_step) {
      step = '<span class="chip good">Settled until next cycle</span>';
    } else {
      var attests = a.next_step_may_attest;
      step = '<span class="chip ' + (attests === false ? 'warn' : 'plain') + '">' +
        Muster.escape(Muster.STEP_LABEL[a.next_step] || a.next_step) + '</span>';
      if (attests === false) {
        step += '<span class="cell-sub">may not attest</span>';
      }
    }
  }

  return '<tr class="subject-row" tabindex="0" role="button" data-subject="' +
      Muster.escape(s.subject_id) + '"' +
      (Muster.state.selected === s.subject_id ? ' aria-selected="true"' : '') + '>' +
    '<td><div class="subject-cell">' + Muster.avatar(s.display_name, s.subject_id) +
      '<div><span class="cell-name">' + Muster.escape(s.display_name) + '</span>' +
      '<span class="cell-sub mono">' + Muster.escape(s.subject_id) +
      (s.needs_human_path ? ' &middot; enrolled human path' : '') + '</span></div></div></td>' +
    '<td class="mono nowrap">' + Muster.escape(s.reference) + '</td>' +
    '<td class="mono nowrap">' + Muster.escape(s.country_code) + '</td>' +
    '<td>' + (a ? Muster.gradeChip(a.grade) : '<span class="chip plain">pending</span>') + '</td>' +
    '<td>' + (a ? Muster.reconChip(a.reconciliation.outcome) : '') +
      (a && a.reconciliation.opens_correction_case
        ? '<span class="cell-sub">correction case open</span>' : '') + '</td>' +
    '<td class="nowrap">' + (due
      ? Muster.escape(due) + '<span class="cell-sub">' + Muster.escape(a.interval_days) + '-day interval</span>'
      : '<span class="cell-sub">no schedule &mdash; a person owns it</span>') + '</td>' +
    '<td>' + step + '</td>' +
    '</tr>';
};

Muster.renderRegisterGrid = function () {
  var host = document.getElementById('register-grid');
  if (!host) { return; }

  var groupBy = Muster.state.groupBy;
  var rows = Muster.subjects().map(function (s) {
    return { subject: s, attestation: Muster.attestation(s.subject_id) };
  });

  var order = [];
  var buckets = {};
  rows.forEach(function (row) {
    var key = Muster.groupKey(row, groupBy);
    if (!buckets[key]) { buckets[key] = { rows: [], weight: Muster.groupWeight(row, groupBy) }; order.push(key); }
    buckets[key].rows.push(row);
  });
  order.sort(function (a, b) {
    if (buckets[a].weight !== buckets[b].weight) { return buckets[a].weight - buckets[b].weight; }
    return a.localeCompare(b);
  });

  var body = order.map(function (key) {
    var bucket = buckets[key];
    var lead = bucket.rows[0];
    var grade = (groupBy === 'status' && lead && lead.attestation) ? lead.attestation.grade : '';
    return '<tr class="group-row"><th colspan="7" scope="colgroup"' +
      (grade ? ' data-grade="' + Muster.escape(grade) + '"' : '') + '>' +
      '<span class="group-dot" aria-hidden="true"></span>' +
      '<span class="group-name">' + Muster.escape(key) + '</span>' +
      '<span class="group-count">' + bucket.rows.length + '</span></th></tr>' +
      bucket.rows.map(Muster.registerRow).join('');
  }).join('');

  host.innerHTML = '<div class="table-scroll"><table class="grid">' +
    '<caption class="visually-hidden">Enrolled subjects with the grade of this cycle</caption>' +
    '<thead><tr>' +
      '<th scope="col">Subject</th>' +
      '<th scope="col">Reference</th>' +
      '<th scope="col">Country</th>' +
      '<th scope="col">Grade</th>' +
      '<th scope="col">Reconciliation</th>' +
      '<th scope="col">Next due</th>' +
      '<th scope="col">Next step</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div>';

  var note = document.getElementById('register-note');
  if (note) {
    note.textContent = rows.length + ' subjects, grouped by ' + groupBy.replace(/_/g, ' ');
  }
};

/* ------------------------------------------------------------------ cases */

Muster.leadCaseMarkup = function (row) {
  var s = row.subject;
  var a = row.attestation;
  var reg = a.reconciliation.register;

  return '<article class="card case-lead">' +
    '<header class="card-head">' +
      '<h2 class="card-title">' + Muster.escape(s.display_name) +
        ' &mdash; the register records a death she did not have</h2>' +
      '<p class="card-sub">Subject ' + Muster.escape(s.subject_id) + ', reference ' +
        Muster.escape(s.reference) + '. The death register recorded her as deceased on ' +
        Muster.escape(reg ? Muster.formatDate(reg.recorded_on) : 'an earlier date') +
        '. She has since answered a call and passed a freshness challenge minted seconds before she said it back.</p>' +
    '</header>' +
    '<div class="card-body">' +
      '<div class="stated">' +
        'The correction belongs to <strong>the register</strong>, not to her. ' +
        'She is not asked to prove anything further, and nothing here alters her payment.' +
        '<span class="keyline">This never stops a payment.</span>' +
      '</div>' +
      '<dl class="factlist">' +
        '<div><dt>Grade this cycle</dt><dd>' + Muster.gradeChip(a.grade) + ' ' +
          Muster.escape(Muster.GRADE_MEANING[a.grade] || '') + '</dd></div>' +
        '<div><dt>Reconciliation</dt><dd>' + Muster.reconChip(a.reconciliation.outcome) + '</dd></div>' +
        '<div><dt>Register says</dt><dd class="mono">' +
          Muster.escape(reg ? reg.status : 'unknown') + ', recorded ' +
          Muster.escape(reg ? reg.recorded_on : '--') + ', source: ' +
          Muster.escape(reg ? reg.source : '--') + '</dd></div>' +
        '<div><dt>Why it is a case</dt><dd><div class="reason-chips">' +
          a.reconciliation.reasons.map(function (r) {
            return '<span class="chip violet">' + Muster.escape(r) + '</span>';
          }).join('') + '</div></dd></div>' +
        '<div><dt>Payment</dt><dd>Unchanged. <span class="mono">stops_payment = ' +
          Muster.escape(a.reconciliation.stops_payment) + '</span></dd></div>' +
        '<div><dt>Next due</dt><dd>' +
          Muster.escape(a.next_due ? Muster.formatDate(a.next_due) : 'no schedule') + '</dd></div>' +
      '</dl>' +
      '<p class="card-sub" style="margin-top:1rem">Under the paper process a person the ' +
        'register has wrongly recorded as dead has, in practice, no channel to argue. ' +
        'A call gives her one, and the record of it is dated and evidence-linked.</p>' +
      '<p style="margin-top:0.8rem"><button class="btn-quiet" data-open-subject="' +
        Muster.escape(s.subject_id) + '" type="button">Open the attestation</button></p>' +
    '</div>' +
    '</article>';
};

Muster.renderCases = function () {
  var host = document.getElementById('view-cases');
  if (!host) { return; }

  var rows = Muster.caseSubjects();
  if (!rows.length) {
    host.innerHTML = '<article class="card"><div class="card-body">' +
      '<p class="loading">No open cases in this cycle.</p></div></article>';
    return;
  }

  var lead = rows[0] && rows[0].attestation.reconciliation.opens_correction_case ? rows[0] : null;
  var rest = lead ? rows.slice(1) : rows;

  var restRows = rest.map(function (row) {
    var s = row.subject;
    var a = row.attestation;
    return '<tr class="subject-row" tabindex="0" role="button" data-subject="' +
        Muster.escape(s.subject_id) + '">' +
      '<td><div class="subject-cell">' + Muster.avatar(s.display_name, s.subject_id) +
        '<div><span class="cell-name">' + Muster.escape(s.display_name) + '</span>' +
        '<span class="cell-sub mono">' + Muster.escape(s.reference) + '</span></div></div></td>' +
      '<td>' + Muster.gradeChip(a.grade) + '</td>' +
      '<td>' + Muster.escape(Muster.GRADE_MEANING[a.grade] || '') + '</td>' +
      '<td><div class="reason-chips">' + a.reasons.map(function (r) {
        return '<span class="chip plain">' + Muster.escape(r) + '</span>';
      }).join('') + '</div></td>' +
      '<td class="nowrap">' + (a.next_step
        ? Muster.escape(Muster.STEP_LABEL[a.next_step] || a.next_step) +
          (a.next_step_may_attest === false ? '<span class="cell-sub">may not attest</span>' : '')
        : '<span class="cell-sub">settled</span>') + '</td>' +
      '<td class="nowrap">' + Muster.escape(a.next_due ? Muster.formatDate(a.next_due) : 'a person owns it') + '</td>' +
      '</tr>';
  }).join('');

  host.innerHTML =
    (lead ? Muster.leadCaseMarkup(lead) : '') +
    '<article class="card">' +
      '<header class="card-head">' +
        '<h2 class="card-title">Everything this cycle did not close</h2>' +
        '<p class="card-sub">Any grade other than confirmed live opens a case for a person, ' +
          'and so does a call that contradicts the register. Not closing is the common ' +
          'outcome by design. None of these lines stops a payment.</p>' +
      '</header>' +
      '<div class="card-body flush"><div class="table-scroll"><table class="grid">' +
        '<thead><tr><th scope="col">Subject</th><th scope="col">Grade</th>' +
        '<th scope="col">What it means</th><th scope="col">Named reasons</th>' +
        '<th scope="col">Next step</th><th scope="col">Next due</th></tr></thead>' +
        '<tbody>' + restRows + '</tbody></table></div></div>' +
    '</article>';
};

/* --------------------------------------------------------------- protocol */

Muster.renderProtocol = function () {
  var host = document.getElementById('view-protocol');
  if (!host) { return; }
  var ladder = Muster.state.ladder;

  var stages = Muster.STAGES.map(function (stage, index) {
    return '<div class="stage">' +
      '<span class="stage-no">' + (index + 1) + '</span>' +
      '<div><h4>' + Muster.escape(stage.name) + '</h4>' +
      '<p>' + Muster.escape(stage.body) + '</p></div>' +
      '</div>';
  }).join('');

  var rungs = '<p class="loading">The escalation ladder could not be loaded.</p>';
  if (ladder) {
    rungs = '<div class="rungs">' + ladder.rungs.map(function (rung) {
      return '<div class="rung" data-attest="' + Muster.escape(rung.may_attest) + '">' +
        '<span class="rung-marker"><span class="rung-dot"></span><span class="rung-line"></span></span>' +
        '<div>' +
          '<div class="rung-head">' +
            '<span class="rung-name">' + Muster.escape(rung.step) + '</span>' +
            '<span class="chip ' + (rung.may_attest ? 'good' : 'warn') + '">' +
              (rung.may_attest ? 'may attest' : 'may NOT attest') + '</span>' +
            '<span class="chip plain">' + Muster.escape(rung.dials ? 'places a call' : 'no call') + '</span>' +
            '<span class="rung-days">' + (rung.days ? rung.days + ' days before the next rung' : 'terminal rung') + '</span>' +
          '</div>' +
          '<p>' + Muster.escape(rung.purpose) + '</p>' +
        '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  var intervals = '';
  if (ladder) {
    intervals = '<div class="table-scroll"><table class="grid narrow">' +
      '<thead><tr><th scope="col">Grade</th><th scope="col">Next attempt</th>' +
      '<th scope="col">Why</th></tr></thead><tbody>' +
      Muster.GRADE_ORDER.map(function (grade) {
        var days = ladder.intervals[grade];
        return '<tr><td>' + Muster.gradeChip(grade) + '</td>' +
          '<td class="mono nowrap">' + (days === null || days === undefined
            ? 'no schedule' : days + (days === 1 ? ' day' : ' days')) + '</td>' +
          '<td>' + Muster.escape(Muster.GRADE_MEANING[grade] || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="axis-note">An interval is never a deadline for the subject. Nothing expires, ' +
      'and missing a cycle changes no payment.</p>';
  }

  host.innerHTML =
    '<article class="card">' +
      '<header class="card-head">' +
        '<h2 class="card-title">Four stages, one call</h2>' +
        '<p class="card-sub">The model extracts observations. Code decides. The grade is computed ' +
          'from the enrolment record and the challenge that was actually issued, never emitted ' +
          'by the model.</p>' +
      '</header>' +
      '<div class="card-body"><div class="stages">' + stages + '</div></div>' +
    '</article>' +

    '<article class="card">' +
      '<header class="card-head">' +
        '<h2 class="card-title">Escalation ladder</h2>' +
        '<p class="card-sub">Not confirming is the common case, so the ladder climbs instead of ' +
          'giving up' + (ladder ? ', reaching a person in ' + Muster.escape(ladder.days_to_human) + ' days' : '') +
          '. The last two rungs speak to somebody other than the subject, and neither of them ' +
          'can ever produce a life attestation. That rule is enforced in code, not in a prompt.</p>' +
      '</header>' +
      '<div class="card-body">' + rungs + '</div>' +
    '</article>' +

    '<article class="card">' +
      '<header class="card-head">' +
        '<h2 class="card-title">Cadence</h2>' +
        '<p class="card-sub">How soon the next attempt is made, by what the last call established.</p>' +
      '</header>' +
      '<div class="card-body">' + intervals + '</div>' +
    '</article>';
};

/* --------------------------------------------------------------- exposure */

Muster.renderExposureView = function () {
  var host = document.getElementById('view-exposure');
  if (!host) { return; }
  var exposure = Muster.state.exposure;

  if (!exposure) {
    host.innerHTML = '<article class="card"><div class="card-body">' +
      '<p class="loading">The exposure model could not be loaded.</p></div></article>';
    return;
  }

  var cases = exposure.cases.map(function (c) {
    return '<article class="card">' +
      '<header class="card-head">' +
        '<h2 class="card-title">' + Muster.escape(c.title) + '</h2>' +
        '<p class="card-sub mono">' + Muster.escape(c.citation) + '</p>' +
      '</header>' +
      '<div class="card-body">' +
        '<dl class="factlist">' +
          '<div><dt>Died</dt><dd class="mono">' + Muster.escape(c.died) + '</dd></div>' +
          '<div><dt>Detected</dt><dd class="mono">' + Muster.escape(c.detected) + '</dd></div>' +
          '<div><dt>Days undetected</dt><dd class="mono num">' + Muster.commas(c.actual_days) + '</dd></div>' +
          '<div><dt>Modelled worst case</dt><dd class="mono num">' + Muster.commas(c.modelled_days) +
            ' &mdash; ' + Muster.escape(exposure.interval_days) + '-day interval plus ' +
            Muster.escape(exposure.ladder_days) + ' days of escalation</dd></div>' +
          '<div><dt>Reduction</dt><dd class="mono num">' + Muster.escape(c.reduction_factor) + 'x</dd></div>' +
          '<div><dt>Note</dt><dd>' + Muster.escape(c.note) + '</dd></div>' +
        '</dl>' +
      '</div>' +
      '</article>';
  }).join('');

  host.innerHTML =
    '<article class="card">' +
      '<header class="card-head">' +
        '<h2 class="card-title">Exposure against cadence</h2>' +
        '<p class="card-sub">Frequency beats strength here. A weak check run monthly caps the ' +
          'window; a strong certificate gathered once a year does not, and costs a journey ' +
          'many pensioners cannot make.</p>' +
      '</header>' +
      '<div class="card-body">' + Muster.chartMarkup(exposure) + '</div>' +
    '</article>' +
    '<article class="card">' +
      '<header class="card-head"><h2 class="card-title">The assumption doing the work</h2></header>' +
      '<div class="card-body"><div class="stated">' + Muster.escape(exposure.assumption) + '</div></div>' +
    '</article>' +
    cases;
};

/* -------------------------------------------------------------- adversary */

Muster.renderAdversary = function () {
  var host = document.getElementById('view-adversary');
  if (!host) { return; }
  var data = Muster.state.adversary;

  if (!data) {
    host.innerHTML = '<article class="card"><div class="card-body">' +
      '<p class="loading">The adversary scoreboard could not be loaded.</p></div></article>';
    return;
  }

  var missed = data.total - data.caught;

  var rows = data.attacks.map(function (attack) {
    return '<tr class="' + (attack.caught ? '' : 'not-caught') + '">' +
      '<td><span class="cell-name">' + Muster.escape(attack.name) + '</span>' +
        '<span class="cell-sub mono">' + Muster.escape(attack.key) + '</span></td>' +
      '<td>' + Muster.escape(attack.description) + '</td>' +
      '<td>' + Muster.gradeChip(attack.grade) + '</td>' +
      '<td class="nowrap">' + (attack.caught
        ? '<span class="chip good">caught</span>'
        : '<span class="chip warn">NOT caught</span>') + '</td>' +
      '<td class="nowrap"><span class="chip ' + (attack.as_documented ? 'plain' : 'warn') + '">' +
        'as_documented = ' + Muster.escape(attack.as_documented) + '</span>' +
        '<span class="cell-sub">expected ' +
        Muster.escape(attack.expected_caught ? 'caught' : 'not caught') + '</span></td>' +
      '</tr>';
  }).join('');

  host.innerHTML =
    '<article class="card">' +
      '<header class="card-head">' +
        '<h2 class="card-title">Adversary scoreboard</h2>' +
        '<p class="card-sub">' + Muster.escape(data.caught) + ' of ' + Muster.escape(data.total) +
          ' attacks are caught. The other ' + Muster.escape(missed) + ' are not, they are listed ' +
          'anyway, and the test suite asserts that they are still not caught &mdash; so if that ' +
          'ever changes somebody has to come here and say so deliberately.</p>' +
      '</header>' +
      '<div class="card-body flush"><div class="table-scroll"><table class="grid">' +
        '<thead><tr><th scope="col">Attack</th><th scope="col">What it looks like</th>' +
        '<th scope="col">Grade returned</th><th scope="col">Outcome</th>' +
        '<th scope="col">Documented</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
        '<div class="card-body">' +
          '<p class="limit-note"><strong>Why a synthesised voice is not caught.</strong> ' +
          'CALL-E returns transcripts, not audio. Muster never receives a waveform, so no ' +
          'speaker verification of any kind is possible from this pipeline. A replayed or ' +
          'synthesised voice that answers live and says the freshness words back will be ' +
          'graded confirmed live. The same applies to a household member who knows the ' +
          'enrolled answers: the knowledge challenge is what closes impersonation by a ' +
          'stranger, and it does not close impersonation by a relative.</p>' +
        '</div>' +
      '</div>' +
    '</article>';
};

/* ----------------------------------------------------------------- ledger */

Muster.renderLedger = function () {
  var host = document.getElementById('view-ledger');
  if (!host) { return; }

  var subjectId = Muster.state.ledgerSubject;
  var data = subjectId ? Muster.state.ledger[subjectId] : null;

  var options = Muster.subjects().map(function (s) {
    return '<option value="' + Muster.escape(s.subject_id) + '"' +
      (s.subject_id === subjectId ? ' selected' : '') + '>' +
      Muster.escape(s.display_name) + ' (' + Muster.escape(s.subject_id) + ')</option>';
  }).join('');

  var body = '<p class="loading">Loading the chain.</p>';
  if (data) {
    body = '<p class="integrity" data-intact="' + Muster.escape(data.intact) + '">' +
        '<span class="dot"></span>' +
        (data.intact
          ? 'Chain intact. Every entry hashes over the one before it.'
          : 'Chain broken at entry ' + Muster.escape(data.broken_at) + '.') +
      '</p>' +
      '<div class="chain">' + data.entries.map(function (entry, index) {
        return '<div class="chain-entry">' +
          '<div class="chain-hashes">' +
            '<span class="chip plain">#' + (index + 1) + '</span>' +
            Muster.gradeChip(entry.grade) +
            '<span>' + Muster.escape(Muster.formatStamp(entry.graded_at)) + '</span>' +
          '</div>' +
          '<div class="chain-hashes">' +
            '<span><b>previous</b> ' + Muster.escape(entry.previous) + '</span>' +
            '<span><b>this</b> ' + Muster.escape(entry.this) + '</span>' +
          '</div>' +
          '</div>';
      }).join('') + '</div>';
  }

  host.innerHTML =
    '<article class="card">' +
      '<header class="card-head card-head-row">' +
        '<div>' +
          '<h2 class="card-title">Attestation ledger</h2>' +
          '<p class="card-sub">Each attestation hashes over the one before it, so a record ' +
            'cannot be edited after the fact without breaking every entry that follows. ' +
            'Hashes are shown truncated to sixteen characters.</p>' +
        '</div>' +
        '<label class="field"><span class="field-label">Subject</span>' +
          '<select id="ledger-subject">' + options + '</select></label>' +
      '</header>' +
      '<div class="card-body">' + body + '</div>' +
    '</article>';
};

/* --------------------------------------------------------- attestation panel */

Muster.panelMarkup = function (a) {
  var roster = Muster.state.roster;
  var scenarios = roster ? roster.scenarios : {};

  var nonceValue = a.nonce_ok === null || a.nonce_ok === undefined
    ? '<span class="kv-value muted">not asked</span>'
    : '<span class="kv-value">' + (a.nonce_ok ? 'passed' : 'failed') + '</span>';

  var nonceFoot = a.nonce_ok === null || a.nonce_ok === undefined
    ? '<p class="scenario-desc">The freshness challenge was never put to anybody, because ' +
      'nobody self-identified as the subject. That is an unasked question, not a wrong answer.</p>'
    : '';

  var words = a.challenge.words.map(function (w) {
    return '<span class="word">' + Muster.escape(w) + '</span>';
  }).join('') + '<span class="word weekday">' + Muster.escape(a.challenge.weekday) + '</span>';

  var prompts = a.prompts.map(function (p) {
    return '<tr><td class="mono nowrap">' + Muster.escape(p.prompt_id) + '</td>' +
      '<td>' + Muster.escape(p.question) + '</td>' +
      '<td class="nowrap">' + (p.co_resident_safe
        ? '<span class="chip good">co_resident_safe</span>'
        : '<span class="chip warn">not co-resident safe</span>') + '</td></tr>';
  }).join('');

  var quotes = a.evidence_quotes.length
    ? a.evidence_quotes.map(function (q) {
        return '<blockquote class="quote">' + Muster.escape(q) + '</blockquote>';
      }).join('')
    : '<p class="scenario-desc">No quoted span was retained for this call.</p>';

  var turns = a.transcript.map(function (t) {
    var who = t.speaker === 'unknown' ? 'unattributed' : t.speaker;
    return '<div class="turn" data-speaker="' + Muster.escape(t.speaker) + '">' +
      '<span class="turn-at">' + Number(t.offset_seconds).toFixed(1) + 's</span>' +
      '<span class="turn-who">' + Muster.escape(who) + '</span>' +
      '<span class="turn-text">' + Muster.escape(t.text) + '</span>' +
      '</div>';
  }).join('');

  var scenarioOptions = Object.keys(scenarios).map(function (key) {
    return '<option value="' + Muster.escape(key) + '"' +
      (key === a.scenario ? ' selected' : '') + '>' + Muster.escape(key) + '</option>';
  }).join('');

  var recon = a.reconciliation;

  return '<div class="panel-head">' +
      '<div><h2>' + Muster.escape(a.display_name) + '</h2>' +
      '<p class="panel-ref">' + Muster.escape(a.subject_id) + ' &middot; ' +
        Muster.escape(a.masked_phone) + '</p></div>' +
      '<button class="panel-close" id="panel-close" type="button" aria-label="Close attestation">&times;</button>' +
    '</div>' +

    '<section class="panel-block">' +
      '<h3>What this call established</h3>' +
      '<p class="verdict" data-grade="' + Muster.escape(a.grade) + '">' +
        '<span class="verdict-grade">' + Muster.escape(Muster.GRADE_LABEL[a.grade] || a.grade) + '</span>' +
        '<span class="chip ' + (a.auto_closes ? 'good' : 'plain') + '">' +
          (a.auto_closes ? 'closes automatically' : 'opens a case for a person') + '</span>' +
      '</p>' +
      '<p class="scenario-desc">' + Muster.escape(Muster.GRADE_MEANING[a.grade] || '') + '</p>' +
      '<p class="nostop">This never stops a payment.</p>' +
    '</section>' +

    '<section class="panel-block">' +
      '<h3>Named reasons</h3>' +
      '<div class="reason-chips">' + a.reasons.map(function (r) {
        return '<span class="chip" data-grade="' + Muster.escape(a.grade) + '">' + Muster.escape(r) + '</span>';
      }).join('') + '</div>' +
    '</section>' +

    (a.coaching_suspected
      ? '<section class="panel-block"><h3>Coaching</h3>' +
        '<p class="warnbox"><strong>Coaching suspected.</strong> An unattributed voice supplied ' +
        'an answer before the subject gave it. This is a timing heuristic and it only ever ' +
        'downgrades: it routes the call to a person and never concludes anything about the ' +
        'subject. The turns it fired on are marked in the transcript below.</p></section>'
      : '') +

    '<section class="panel-block">' +
      '<h3>Freshness challenge issued</h3>' +
      '<div class="challenge-words">' + words + '</div>' +
      '<p class="scenario-desc">Three words to say back in order, then what day of the week it is. ' +
        'Minted for this call alone.</p>' +
      '<div class="kv" style="margin-top:0.9rem">' +
        '<div class="kv-item"><p class="kv-label">Nonce</p>' + nonceValue + '</div>' +
        '<div class="kv-item"><p class="kv-label">Challenges</p>' +
          '<p class="kv-value">' + Muster.escape(a.challenges_passed) + ' of ' +
          Muster.escape(a.challenges_asked) + '</p></div>' +
        '<div class="kv-item"><p class="kv-label">Auto-closes</p>' +
          '<p class="kv-value">' + Muster.escape(a.auto_closes) + '</p></div>' +
        '<div class="kv-item"><p class="kv-label">Stops payment</p>' +
          '<p class="kv-value">' + Muster.escape(a.stops_payment) + '</p></div>' +
      '</div>' + nonceFoot +
    '</section>' +

    '<section class="panel-block">' +
      '<h3>Knowledge prompts asked</h3>' +
      '<div class="table-scroll"><table class="grid narrow"><thead><tr>' +
        '<th scope="col">Prompt</th><th scope="col">Question</th><th scope="col">Enrolment</th>' +
      '</tr></thead><tbody>' + prompts + '</tbody></table></div>' +
      '<p class="scenario-desc">A prompt that is not co-resident safe still runs, but it cannot ' +
        'on its own carry a confirmed live: a housemate would plausibly know the answer.</p>' +
    '</section>' +

    '<section class="panel-block">' +
      '<h3>Reconciliation against the register</h3>' +
      '<p>' + Muster.reconChip(recon.outcome) +
        (recon.opens_correction_case
          ? ' <span class="chip violet">correction case open</span>' : '') + '</p>' +
      '<div class="reason-chips" style="margin-top:0.5rem">' + recon.reasons.map(function (r) {
        return '<span class="chip plain">' + Muster.escape(r) + '</span>';
      }).join('') + '</div>' +
      (recon.register
        ? '<p class="scenario-desc">Register: <span class="mono">' + Muster.escape(recon.register.status) +
          '</span>, recorded ' + Muster.escape(Muster.formatDate(recon.register.recorded_on)) +
          ', source ' + Muster.escape(recon.register.source) + '.</p>'
        : '<p class="scenario-desc">The register holds no entry for this subject.</p>') +
      (recon.opens_correction_case
        ? '<p class="warnbox" style="margin-top:0.7rem">The correction belongs to the register, ' +
          'not to the person. Her payment does not stop.</p>'
        : '') +
    '</section>' +

    '<section class="panel-block">' +
      '<h3>Evidence retained</h3>' +
      '<div class="quotes">' + quotes + '</div>' +
      '<p class="scenario-desc">Transcripts are retained only as the quoted spans that justify ' +
        'a grade.</p>' +
    '</section>' +

    '<section class="panel-block">' +
      '<h3>Transcript</h3>' +
      '<div class="timeline">' + turns + '</div>' +
      '<p class="scenario-desc">A turn marked <em>unattributed</em> is a voice CALL-E could not ' +
        'assign to either party. It is the coaching signal, and it is never read as an answer.</p>' +
    '</section>' +

    '<section class="panel-block">' +
      '<h3>Schedule</h3>' +
      '<div class="kv">' +
        '<div class="kv-item"><p class="kv-label">Next due</p><p class="kv-value">' +
          Muster.escape(a.next_due ? a.next_due : 'no schedule') + '</p></div>' +
        '<div class="kv-item"><p class="kv-label">Interval</p><p class="kv-value">' +
          Muster.escape(a.interval_days === null ? 'a person owns it' : a.interval_days + ' days') +
          '</p></div>' +
        '<div class="kv-item"><p class="kv-label">Next step</p><p class="kv-value">' +
          Muster.escape(a.next_step ? a.next_step : 'settled') + '</p></div>' +
        '<div class="kv-item"><p class="kv-label">May attest</p><p class="kv-value">' +
          Muster.escape(a.next_step_may_attest === null ? 'not applicable' : a.next_step_may_attest) +
          '</p></div>' +
      '</div>' +
      (a.next_step_purpose
        ? '<p class="scenario-desc">' + Muster.escape(a.next_step_purpose) + '</p>' : '') +
    '</section>' +

    '<section class="panel-block">' +
      '<h3>Re-run this subject under another scenario</h3>' +
      '<div class="scenario-row">' +
        '<select id="scenario-select" aria-label="Scenario">' + scenarioOptions + '</select>' +
        '<button class="btn-primary" id="scenario-run" type="button">Re-run the call</button>' +
      '</div>' +
      '<p class="scenario-desc" id="scenario-desc">' +
        Muster.escape(scenarios[a.scenario] || '') + '</p>' +
      '<p class="scenario-desc">Scripted CALL-E fixtures against fictional numbers. The console ' +
        'cannot place a live call.</p>' +
    '</section>' +

    '<section class="panel-block">' +
      '<h3>Call task as issued</h3>' +
      '<div class="taskbox">' + Muster.escape(a.task_text) + '</div>' +
    '</section>';
};

/* -------------------------------------------------------------- status bar */

Muster.renderStatusBar = function () {
  var host = document.getElementById('status-counts');
  if (!host) { return; }
  var tally = Muster.tallies();

  var items = Muster.GRADE_ORDER.filter(function (g) { return tally.byGrade[g]; })
    .map(function (g) {
      return '<li data-grade="' + Muster.escape(g) + '"><span class="dot"></span>' +
        '<span class="num">' + tally.byGrade[g] + '</span> ' +
        Muster.escape((Muster.GRADE_LABEL[g] || g).toLowerCase()) + '</li>';
    });

  if (tally.corrections) {
    items.push('<li data-recon="REGISTER_CONTRADICTED"><span class="dot"></span>' +
      '<span class="num">' + tally.corrections + '</span> register contradicted</li>');
  }

  host.innerHTML = items.length ? items.join('') : '<li>Loading the register</li>';

  var badge = document.getElementById('cases-badge');
  var bell = document.getElementById('bell-badge');
  var open = Muster.caseSubjects().length;
  if (badge) { badge.textContent = open; }
  if (bell) { bell.textContent = open; }
};
