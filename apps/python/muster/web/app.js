/* Muster console - wiring.
   Routing, event handlers, and the order in which views are painted. */

(function () {
  'use strict';

  var VIEWS = ['register', 'cases', 'protocol', 'exposure', 'adversary', 'ledger'];

  function byId(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------- painting */

  function paint() {
    Muster.renderKpis();
    Muster.renderExposureChart();
    Muster.renderRegisterGrid();
    Muster.renderCases();
    Muster.renderProtocol();
    Muster.renderExposureView();
    Muster.renderAdversary();
    Muster.renderLedger();
    Muster.renderStatusBar();
  }

  function paintChrome() {
    var roster = Muster.state.roster;
    if (!roster) { return; }

    var scheme = byId('scheme-select');
    if (scheme) {
      scheme.innerHTML = '<option>' + Muster.escape(roster.scheme) + '</option>';
      scheme.title = 'The demo carries one scheme';
    }

    var cycle = byId('cycle-value');
    if (cycle) { cycle.textContent = roster.cycle; }

    var pill = byId('cadence-pill');
    var ladder = Muster.state.ladder;
    if (pill && ladder && ladder.intervals.CONFIRMED_LIVE) {
      pill.textContent = 'Monthly cadence, ' + ladder.intervals.CONFIRMED_LIVE + ' days';
    }
  }

  /* -------------------------------------------------------------- routing */

  function showView(name) {
    var view = VIEWS.indexOf(name) >= 0 ? name : 'register';
    Muster.state.view = view;

    VIEWS.forEach(function (candidate) {
      var section = byId('view-' + candidate);
      if (section) { section.hidden = candidate !== view; }
    });

    Array.prototype.forEach.call(document.querySelectorAll('.topnav-tab'), function (tab) {
      if (tab.getAttribute('data-view') === view) {
        tab.setAttribute('aria-current', 'page');
      } else {
        tab.removeAttribute('aria-current');
      }
    });

    if (view === 'ledger' && Muster.state.ledgerSubject &&
        !Muster.state.ledger[Muster.state.ledgerSubject]) {
      loadLedgerFor(Muster.state.ledgerSubject);
    }

    window.scrollTo(0, 0);
  }

  function routeFromHash() {
    var name = (window.location.hash || '').replace(/^#\/?/, '');
    if (!byId('panel').hidden) { closePanel(); }
    showView(name);
  }

  /* ---------------------------------------------------------------- panel */

  function closePanel() {
    byId('panel').hidden = true;
    byId('scrim').hidden = true;
    Muster.state.selected = null;
    Muster.renderRegisterGrid();
  }

  function paintPanel(attestation) {
    var inner = byId('panel-inner');
    inner.innerHTML = Muster.panelMarkup(attestation);
    byId('panel').hidden = false;
    byId('scrim').hidden = false;
    byId('panel').scrollTop = 0;

    byId('panel-close').addEventListener('click', closePanel);

    var select = byId('scenario-select');
    var desc = byId('scenario-desc');
    if (select && desc) {
      select.addEventListener('change', function () {
        var scenarios = Muster.state.roster ? Muster.state.roster.scenarios : {};
        desc.textContent = scenarios[select.value] || '';
      });
    }

    var run = byId('scenario-run');
    if (run && select) {
      run.addEventListener('click', function () {
        run.disabled = true;
        run.textContent = 'Running';
        Muster.loadAttestation(attestation.subject_id, select.value).then(function (fresh) {
          paintPanel(fresh);
          Muster.renderRegisterGrid();
          Muster.renderCases();
          Muster.renderKpis();
          Muster.renderStatusBar();
        }).catch(function () {
          run.disabled = false;
          run.textContent = 'Re-run the call';
        });
      });
    }
  }

  function openSubject(subjectId) {
    Muster.state.selected = subjectId;
    Muster.renderRegisterGrid();

    var cached = Muster.attestation(subjectId);
    if (cached) {
      paintPanel(cached);
      return;
    }
    byId('panel-inner').innerHTML = '<p class="loading">Loading the attestation.</p>';
    byId('panel').hidden = false;
    byId('scrim').hidden = false;
    Muster.loadAttestation(subjectId, null).then(paintPanel).catch(function () {
      byId('panel-inner').innerHTML =
        '<p class="loading">That attestation could not be loaded. The banner above has the reason.</p>';
    });
  }

  /* --------------------------------------------------------------- ledger */

  function loadLedgerFor(subjectId) {
    Muster.state.ledgerSubject = subjectId;
    Muster.renderLedger();
    Muster.loadLedger(subjectId).then(function () {
      Muster.renderLedger();
    }).catch(function () {
      var host = byId('view-ledger');
      if (host) {
        host.innerHTML = '<article class="card"><div class="card-body">' +
          '<p class="loading">That ledger could not be loaded.</p></div></article>';
      }
    });
  }

  /* -------------------------------------------------------------- reloads */

  function runCycle(button, label) {
    button.disabled = true;
    var original = button.textContent;
    if (label) { button.textContent = label; }
    var refresh = byId('refresh-btn');
    refresh.classList.add('busy');

    Muster.loadAll().then(function () {
      paintChrome();
      paint();
      if (Muster.state.selected) {
        var fresh = Muster.attestation(Muster.state.selected);
        if (fresh) { paintPanel(fresh); }
      }
      if (Muster.state.ledgerSubject) { loadLedgerFor(Muster.state.ledgerSubject); }
    }).catch(function () {
      /* the fault banner already carries the reason */
    }).then(function () {
      button.disabled = false;
      button.textContent = original;
      refresh.classList.remove('busy');
    });
  }

  /* --------------------------------------------------------------- events */

  function wire() {
    window.addEventListener('hashchange', routeFromHash);

    document.addEventListener('click', function (event) {
      var row = event.target.closest ? event.target.closest('[data-subject]') : null;
      if (row) { openSubject(row.getAttribute('data-subject')); return; }

      var opener = event.target.closest ? event.target.closest('[data-open-subject]') : null;
      if (opener) { openSubject(opener.getAttribute('data-open-subject')); }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !byId('panel').hidden) { closePanel(); }
      if (event.key !== 'Enter' && event.key !== ' ') { return; }
      var row = event.target.closest ? event.target.closest('[data-subject]') : null;
      if (row) {
        event.preventDefault();
        openSubject(row.getAttribute('data-subject'));
      }
    });

    byId('scrim').addEventListener('click', closePanel);

    byId('group-select').addEventListener('change', function (event) {
      Muster.state.groupBy = event.target.value;
      Muster.renderRegisterGrid();
    });

    byId('refresh-btn').addEventListener('click', function () {
      runCycle(byId('refresh-btn'), null);
    });

    byId('run-cycle-btn').addEventListener('click', function () {
      runCycle(byId('run-cycle-btn'), 'Running');
    });

    byId('bell-btn').addEventListener('click', function () {
      window.location.hash = '#/cases';
    });

    var userBtn = byId('user-btn');
    var userPop = byId('user-pop');
    userBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = userPop.hidden;
      userPop.hidden = !open;
      userBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function () {
      if (!userPop.hidden) {
        userPop.hidden = true;
        userBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // The demo models one cycle only. Saying so is better than inventing months.
    ['cycle-prev', 'cycle-next'].forEach(function (id) {
      var button = byId(id);
      button.disabled = true;
      button.title = 'The demo models the current cycle only';
    });

    document.addEventListener('change', function (event) {
      if (event.target && event.target.id === 'ledger-subject') {
        loadLedgerFor(event.target.value);
      }
    });
  }

  /* ----------------------------------------------------------------- boot */

  function boot() {
    wire();
    routeFromHash();

    Muster.loadAll().then(function () {
      var subjects = Muster.subjects();
      var contradicted = subjects.filter(function (s) {
        var a = Muster.attestation(s.subject_id);
        return a && a.reconciliation && a.reconciliation.opens_correction_case;
      })[0];
      Muster.state.ledgerSubject = (contradicted || subjects[0] || {}).subject_id || null;

      paintChrome();
      paint();

      if (Muster.state.ledgerSubject) { loadLedgerFor(Muster.state.ledgerSubject); }
    }).catch(function () {
      paint();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
