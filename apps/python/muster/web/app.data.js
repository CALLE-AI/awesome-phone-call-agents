/* Muster console - data layer.
   Loads the read-only API, keeps one copy of it in memory, and formats values.
   Nothing here decides anything: every grade and every reconciliation outcome
   is computed on the server and only displayed. */

var Muster = window.Muster || {};
window.Muster = Muster;

Muster.state = {
  roster: null,
  attestations: {},
  exposure: null,
  adversary: null,
  ladder: null,
  ledger: {},
  ledgerSubject: null,
  view: 'register',
  groupBy: 'status',
  selected: null,
  faults: []
};

/* ------------------------------------------------------------- vocabulary */

Muster.GRADE_LABEL = {
  CONFIRMED_LIVE: 'Confirmed live',
  PRESUMED_LIVE_WEAK: 'Presumed live, weak',
  THIRD_PARTY_CLAIM: 'Third-party claim',
  UNPROVEN: 'Unproven',
  CONTRA: 'Contra',
  NEEDS_HUMAN: 'Needs human'
};

Muster.GRADE_MEANING = {
  CONFIRMED_LIVE: 'Self-identified, freshness challenge passed, knowledge challenge passed, no interference heard.',
  PRESUMED_LIVE_WEAK: 'Reached and answered, but one leg of the protocol is short.',
  THIRD_PARTY_CLAIM: 'Somebody else vouched. That is not evidence of life and never closes an attestation.',
  UNPROVEN: 'Not reached, or reached ambiguously. Silence is not evidence of anything.',
  CONTRA: 'Something contradicts the enrolment. It means a person must look, never that anybody has died.',
  NEEDS_HUMAN: 'Routed to a person. Muster never fails a subject by machine for being unable to complete the protocol.'
};

Muster.GRADE_ORDER = [
  'CONFIRMED_LIVE',
  'PRESUMED_LIVE_WEAK',
  'THIRD_PARTY_CLAIM',
  'NEEDS_HUMAN',
  'UNPROVEN',
  'CONTRA'
];

Muster.RECON_LABEL = {
  AGREED_ALIVE: 'Agreed alive',
  REGISTER_CONTRADICTED: 'Register contradicted',
  REGISTER_UNCORROBORATED: 'Register uncorroborated',
  CALL_SUPPORTS_REGISTER: 'Call supports register',
  NO_SIGNAL: 'No signal'
};

Muster.STEP_LABEL = {
  primary_number: 'Primary number',
  retry_primary: 'Retry primary',
  alternate_number: 'Alternate number',
  nominated_contact: 'Nominated contact',
  human_visit: 'Human visit'
};

Muster.COUNTRY_LABEL = {
  GB: 'United Kingdom',
  US: 'United States'
};

Muster.STAGES = [
  {
    name: 'Reach',
    body: 'Classify the endpoint before anything else: the subject, a third party, ' +
      'voicemail, an IVR, or no answer. Every later stage depends on which of ' +
      'those it was, and three of the five end the call without an attestation.'
  },
  {
    name: 'Self-identification under disclosure',
    body: 'State what the call is, who it is on behalf of, and what it will cause - ' +
      'including that it cannot stop or reduce a payment. Only then ask the ' +
      'person to confirm they are the subject. Disclosure first is what turns a ' +
      'shrug into a statement.'
  },
  {
    name: 'Freshness challenge',
    body: 'A nonce minted for this call alone: three words to say back in order, ' +
      'plus what day of the week it is today. A recording cannot pass a question ' +
      'that did not exist when it was recorded.'
  },
  {
    name: 'Knowledge challenge',
    body: 'Two prompts drawn from a set enrolled out of band by a person. The ' +
      'selection is seeded on subject and cycle, so a retry asks the same ' +
      'questions and cannot be used to fish for an easier set.'
  }
];

/* ---------------------------------------------------------------- fetching */

Muster.fault = function (message) {
  Muster.state.faults.push(message);
  var box = document.getElementById('fault');
  if (!box) { return; }
  box.hidden = false;
  box.innerHTML = '<strong>Could not load part of the console.</strong> ' +
    Muster.state.faults.map(Muster.escape).join(' ');
};

Muster.clearFaults = function () {
  Muster.state.faults = [];
  var box = document.getElementById('fault');
  if (box) { box.hidden = true; box.textContent = ''; }
};

Muster.getJSON = function (path) {
  return fetch(path, { headers: { Accept: 'application/json' } }).then(function (response) {
    if (!response.ok) {
      throw new Error(path + ' returned HTTP ' + response.status);
    }
    return response.json();
  }).catch(function (error) {
    Muster.fault(error.message || String(error));
    throw error;
  });
};

Muster.loadRoster = function () {
  return Muster.getJSON('/api/roster').then(function (data) {
    Muster.state.roster = data;
    return data;
  });
};

Muster.loadAttestation = function (subjectId, scenario) {
  var url = '/api/attest?subject=' + encodeURIComponent(subjectId);
  if (scenario) { url += '&scenario=' + encodeURIComponent(scenario); }
  return Muster.getJSON(url).then(function (data) {
    Muster.state.attestations[subjectId] = data;
    return data;
  });
};

Muster.loadAllAttestations = function () {
  var roster = Muster.state.roster;
  if (!roster) { return Promise.resolve([]); }
  return Promise.all(roster.subjects.map(function (s) {
    return Muster.loadAttestation(s.subject_id, null).catch(function () { return null; });
  }));
};

Muster.loadExposure = function () {
  return Muster.getJSON('/api/exposure').then(function (d) { Muster.state.exposure = d; return d; });
};

Muster.loadAdversary = function () {
  return Muster.getJSON('/api/adversary').then(function (d) { Muster.state.adversary = d; return d; });
};

Muster.loadLadder = function () {
  return Muster.getJSON('/api/ladder').then(function (d) { Muster.state.ladder = d; return d; });
};

Muster.loadLedger = function (subjectId) {
  return Muster.getJSON('/api/ledger?subject=' + encodeURIComponent(subjectId))
    .then(function (d) { Muster.state.ledger[subjectId] = d; return d; });
};

Muster.loadAll = function () {
  Muster.clearFaults();
  return Muster.loadRoster().then(function () {
    return Promise.all([
      Muster.loadAllAttestations(),
      Muster.loadExposure().catch(function () { return null; }),
      Muster.loadAdversary().catch(function () { return null; }),
      Muster.loadLadder().catch(function () { return null; })
    ]);
  });
};

/* -------------------------------------------------------------- selectors */

Muster.subjects = function () {
  var roster = Muster.state.roster;
  return roster ? roster.subjects : [];
};

Muster.attestation = function (subjectId) {
  return Muster.state.attestations[subjectId] || null;
};

Muster.isCase = function (attestation) {
  if (!attestation) { return false; }
  if (attestation.grade !== 'CONFIRMED_LIVE') { return true; }
  return Boolean(attestation.reconciliation && attestation.reconciliation.opens_correction_case);
};

Muster.caseSubjects = function () {
  var rows = Muster.subjects().map(function (s) {
    return { subject: s, attestation: Muster.attestation(s.subject_id) };
  }).filter(function (row) { return Muster.isCase(row.attestation); });

  // The wrongly-recorded death leads: it is the case the paper process cannot surface.
  rows.sort(function (a, b) {
    var ac = a.attestation.reconciliation.opens_correction_case ? 0 : 1;
    var bc = b.attestation.reconciliation.opens_correction_case ? 0 : 1;
    if (ac !== bc) { return ac - bc; }
    return Muster.GRADE_ORDER.indexOf(a.attestation.grade) - Muster.GRADE_ORDER.indexOf(b.attestation.grade);
  });
  return rows;
};

Muster.tallies = function () {
  var byGrade = {};
  var corrections = 0;
  Muster.subjects().forEach(function (s) {
    var a = Muster.attestation(s.subject_id);
    if (!a) { return; }
    byGrade[a.grade] = (byGrade[a.grade] || 0) + 1;
    if (a.reconciliation && a.reconciliation.opens_correction_case) { corrections += 1; }
  });
  return { byGrade: byGrade, corrections: corrections };
};

Muster.groupKey = function (row, groupBy) {
  var a = row.attestation;
  if (groupBy === 'country') {
    return Muster.COUNTRY_LABEL[row.subject.country_code] || row.subject.country_code;
  }
  if (groupBy === 'next_step') {
    if (!a) { return 'Not yet run'; }
    return a.next_step ? Muster.STEP_LABEL[a.next_step] : 'Settled, no further step';
  }
  if (groupBy === 'reconciliation') {
    if (!a) { return 'Not yet run'; }
    return Muster.RECON_LABEL[a.reconciliation.outcome] || a.reconciliation.outcome;
  }
  return a ? (Muster.GRADE_LABEL[a.grade] || a.grade) : 'Not yet run';
};

Muster.groupWeight = function (row, groupBy) {
  if (groupBy === 'status') {
    var index = Muster.GRADE_ORDER.indexOf(row.attestation ? row.attestation.grade : '');
    return index < 0 ? 99 : index;
  }
  return 0;
};

/* ------------------------------------------------------------- formatting */

Muster.escape = function (value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

Muster.commas = function (n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

Muster.humanise = function (token) {
  var text = String(token).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

Muster.formatDate = function (iso) {
  if (!iso) { return null; }
  var parts = String(iso).slice(0, 10).split('-');
  if (parts.length !== 3) { return iso; }
  var months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return Number(parts[2]) + ' ' + months[Number(parts[1]) - 1] + ' ' + parts[0];
};

Muster.formatStamp = function (iso) {
  if (!iso) { return '--'; }
  return String(iso).slice(0, 10) + ' ' + String(iso).slice(11, 19) + ' UTC';
};

/* A person's row carries a circular badge of their initials. The tint is
   derived from the subject id, so the same person keeps the same colour. */

Muster.initials = function (name) {
  var parts = String(name || '').trim().split(/\s+/);
  var first = parts[0] ? parts[0].charAt(0) : '';
  var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase() || '?';
};

Muster.tintHue = function (seed) {
  var text = String(seed || '');
  var total = 0;
  for (var i = 0; i < text.length; i += 1) {
    total = (total * 31 + text.charCodeAt(i)) % 360;
  }
  return total;
};

Muster.avatar = function (name, seed) {
  var hue = Muster.tintHue(seed);
  return '<span class="avatar-lg" aria-hidden="true" style="background:hsl(' + hue +
    ', 62%, 93%);color:hsl(' + hue + ', 46%, 34%)">' +
    Muster.escape(Muster.initials(name)) + '</span>';
};

Muster.gradeChip = function (grade) {
  return '<span class="chip" data-grade="' + Muster.escape(grade) + '">' +
    Muster.escape(Muster.GRADE_LABEL[grade] || grade) + '</span>';
};

Muster.reconChip = function (outcome) {
  return '<span class="chip" data-recon="' + Muster.escape(outcome) + '">' +
    Muster.escape(Muster.RECON_LABEL[outcome] || outcome) + '</span>';
};
