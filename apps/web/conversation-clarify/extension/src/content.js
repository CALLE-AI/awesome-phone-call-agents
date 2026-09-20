/**
 * The panel: read the open thread, show what is unresolved, take an explicit
 * confirmation, then report what the call established — or refuse to.
 *
 * Everything the user approves is shown before they approve it: the exact
 * question that will be asked, the masked destination, and whether this
 * deployment can dial a real phone at all.
 */
(function () {
  'use strict';

  const {
    readThread, readPasted, expandAll, scrollToMessage,
  } = window.ConversationClarifyExtract;
  const PANEL_ID = 'conversation-clarify-panel';
  const POLL_INTERVAL_MS = 4000;
  const POLL_LIMIT = 120; // ~8 minutes; a bounded call runs for about two

  let state = {};

  // --- plumbing --------------------------------------------------------------

  function send(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // textContent, never innerHTML
    return node;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- shell -----------------------------------------------------------------

  const LABEL = 'Call-E Clarify';
  const ICON = '\u{1F4DE}';   // telephone receiver

  /** Icon and label as separate nodes: markFinding rewrites only the label. */
  function fillButton(button) {
    const icon = el('span', 'cr-ico', ICON);
    icon.setAttribute('aria-hidden', 'true');   // the label already says it
    button.replaceChildren(icon, el('span', 'cr-txt', LABEL));
    return button;
  }

  // Remembered so a re-mounted button does not lose its state. Gmail destroys
  // and rebuilds the reply row constantly; a freshly created button would
  // otherwise come back plain while the finding is still there.
  let lastFindingCount = 0;

  /**
   * The row holding Reply and Forward.
   *
   * Found by locating the Reply control and walking up until the ancestor also
   * contains Forward — targeting the row by class put the button in the row
   * above, next to Gmail's smart-reply chips.
   */
  function replyRow() {
    const direct = document.querySelector(
      'span.ams.bkH, [role="link"][aria-label^="Reply"], [role="button"][aria-label^="Reply"]'
    );
    const reply = direct || Array.from(
      document.querySelectorAll('span[role="link"], div[role="button"], span[role="button"]')
    ).find((node) => /^reply$/i.test((node.textContent || '').trim()));
    if (!reply) return null;

    let node = reply.parentElement;
    for (let depth = 0; depth < 3 && node; depth += 1) {
      if (/forward/i.test(node.textContent || '')) return node;
      node = node.parentElement;
    }
    return reply.parentElement;
  }

  /** Put the button where Reply and Forward are. Returns true when placed. */
  function mountInline() {
    const existing = document.getElementById('conversation-clarify-inline');
    if (existing && existing.isConnected) return true;

    const row = replyRow();
    if (!row) return false;
    const button = fillButton(el('button', 'cr-inline'));
    button.id = 'conversation-clarify-inline';
    button.addEventListener('click', start);
    row.appendChild(button);
    markFinding(lastFindingCount);   // a rebuilt row must not lose the badge
    return true;
  }

  function launcher() {
    let button = document.getElementById('conversation-clarify-launcher');
    if (button) return button;
    button = fillButton(el('button', 'cr-launcher'));
    button.id = 'conversation-clarify-launcher';
    button.addEventListener('click', start);
    document.body.appendChild(button);
    return button;
  }

  /** Show the inline button when Gmail gives us a home for it, else the floating one. */
  function mountEntryPoints() {
    const inline = mountInline();
    launcher().hidden = inline || Boolean(document.getElementById(PANEL_ID));
    return inline;
  }

  /** Mark the entry points when an automatic check found something. */
  function markFinding(count) {
    lastFindingCount = count;
    [document.getElementById('conversation-clarify-inline'),
     document.getElementById('conversation-clarify-launcher')].forEach((node) => {
      if (!node) return;
      node.classList.toggle('cr-has-finding', count > 0);
      const label = node.querySelector('.cr-txt');
      if (label) label.textContent = count > 0 ? `${LABEL} · ${count}` : LABEL;
      node.title = count > 0
        ? `${count} thing${count === 1 ? '' : 's'} a reply here did not settle`
        : 'Check this thread for anything a reply left unsettled';
    });
  }

  function panel() {
    let node = document.getElementById(PANEL_ID);
    if (node) return node;
    node = el('div', 'cr-panel');
    node.id = PANEL_ID;

    const head = el('div', 'cr-head');
    head.appendChild(el('span', 'cr-title', 'Conversation Clarify'));
    const right = el('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';
    const mode = el('span', 'cr-mode', 'checking…');
    mode.id = 'cr-mode';
    const close = el('button', 'cr-close', '×');
    close.title = 'Close';
    close.addEventListener('click', dismiss);
    right.append(mode, close);
    head.appendChild(right);

    const body = el('div', 'cr-body');
    body.id = 'cr-body';

    node.append(head, body);
    document.body.appendChild(node);
    launcher().hidden = true;
    return node;
  }

  function dismiss() {
    const node = document.getElementById(PANEL_ID);
    if (node) node.remove();
    mountEntryPoints();
  }

  function render(...nodes) {
    panel();
    const body = document.getElementById('cr-body');
    body.replaceChildren(...nodes);
  }

  function setMode(health) {
    const badge = document.getElementById('cr-mode');
    if (!badge) return;
    const live = health && health.dials_real_phones;
    badge.textContent = live ? 'live — dials real phones' : 'fixture — no calls';
    badge.className = live ? 'cr-mode cr-live' : 'cr-mode';
  }

  function busy(message) {
    const line = el('div');
    line.append(el('span', 'cr-spin'), document.createTextNode(message));
    render(line);
  }

  function failure(message, retry) {
    const nodes = [el('div', 'cr-error', message)];
    if (retry) {
      const button = el('button', 'cr-btn cr-secondary', 'Try again');
      button.addEventListener('click', retry);
      nodes.push(button);
    }
    nodes.push(pasteToggle());
    render(...nodes);
  }

  // --- step 1: read and analyse ---------------------------------------------

  async function start() {
    busy('Reading this conversation…');

    const health = await send({ type: 'health' });
    if (!health.ok) return failure(health.error, start);
    setMode(health.data);

    // Expand first and wait for the render: reading immediately after the click
    // can still see fragments, and a thread read in fragments can attribute a
    // question to the wrong person.
    const expansion = await expandAll(document);
    if (expansion.gained > 0) busy('Expanding the rest of the thread…');

    const read = readThread(document, { expandedCount: expansion.gained });
    if (!read.ok) return failure(read.reason, start);

    await analyse(read.thread, read.warnings);
  }

  async function analyse(thread, warnings) {
    busy('Looking for anything left unsettled…');
    const response = await send({ type: 'analyze', thread });
    if (!response.ok) return failure(response.error, () => analyse(thread, warnings));

    state = { thread, analysis: response.data };
    showFindings(warnings || []);
  }

  function showFindings(warnings) {
    const { analysis } = state;
    const nodes = [];

    warnings.forEach((text) => nodes.push(el('div', 'cr-warn', text)));

    if (!analysis.findings.length) {
      scrollToMessage(document, Number.MAX_SAFE_INTEGER);   // falls back to the last message
      nodes.push(el('div', 'cr-good', 'Nothing looks unsettled in this thread.'));
      nodes.push(el('p', 'cr-hint',
        'Only two things are flagged: a reply that agrees without saying which option, ' +
        'and one that commits without saying when.'));
      nodes.push(pasteToggle());
      return render(...nodes);
    }

    const finding = analysis.findings[0];
    state.finding = finding;

    if (analysis.model_note) {
      nodes.push(el('div', 'cr-warn',
        `The model pass did not run (${analysis.model_note}). Showing rule findings only.`));
    }

    const card = el('div', 'cr-finding');
    card.appendChild(el('span', 'cr-badge',
      finding.kind === 'unclear_choice' ? 'Unclear choice' : 'No date given'));
    if (finding.source === 'model') {
      const badge = el('span', 'cr-badge cr-badge-model', 'found by model');
      badge.title = 'Matched by the optional model pass, not by the deterministic rules.';
      card.appendChild(badge);
    }
    card.appendChild(el('h4', null, finding.headline));

    const asked = el('div', 'cr-quote');
    asked.appendChild(el('span', 'cr-who', 'You asked'));
    asked.appendChild(document.createTextNode(finding.question));
    const replied = el('div', 'cr-quote');
    replied.style.marginTop = '8px';
    replied.appendChild(el('span', 'cr-who', `${analysis.counterparty || 'They'} replied`));
    replied.appendChild(document.createTextNode(finding.reply));
    card.append(asked, replied);
    nodes.push(card);

    nodes.push(el('div', 'cr-label', 'One call would ask'));
    nodes.push(el('div', 'cr-ask', finding.call_question));

    nodes.push(numberPicker());

    const next = el('button', 'cr-btn', 'Review the call →');
    next.addEventListener('click', () => {
      const chosen = chosenNumber();
      if (chosen.error) return alertInline(chosen.error);
      propose(chosen);
    });
    nodes.push(next);
    nodes.push(pasteToggle());

    render(...nodes);

    // Put the exchange the panel is talking about on screen. After expanding a
    // long thread the relevant reply is usually well below the fold.
    scrollToMessage(document, finding.replied_index);
  }

  // --- number selection ------------------------------------------------------

  function numberPicker() {
    const wrap = el('div');
    wrap.appendChild(el('div', 'cr-label', 'Call which number'));

    const dialable = state.analysis.phone_candidates.filter((c) => c.dialable);
    const select = el('select');
    select.id = 'cr-number';

    dialable.forEach((candidate) => {
      const option = el('option', null, `${candidate.masked} — from ${candidate.sender}'s message`);
      // The value is the opaque id, never the masked label: two different
      // numbers can display identically, and picking by label dialled the wrong one.
      option.value = candidate.id;
      select.appendChild(option);
    });
    const manual = el('option', null, 'Type a number instead…');
    manual.value = '__typed__';
    select.appendChild(manual);

    const typed = el('input');
    typed.id = 'cr-typed';
    typed.placeholder = '+15550100142';
    typed.hidden = dialable.length > 0;
    if (!dialable.length) select.value = '__typed__';

    select.addEventListener('change', () => {
      typed.hidden = select.value !== '__typed__';
    });

    const row = el('div', 'cr-num');
    row.appendChild(select);
    wrap.append(row, typed);

    const unusable = state.analysis.phone_candidates.filter((c) => !c.dialable);
    if (unusable.length) {
      wrap.appendChild(el('p', 'cr-hint',
        `${unusable.length} number${unusable.length === 1 ? '' : 's'} could not be used: `
        + unusable[0].reason));
    }
    if (!dialable.length) {
      wrap.appendChild(el('p', 'cr-hint',
        'No usable number in this thread. Numbers come from the conversation or from you — ' +
        'none are ever looked up.'));
    }
    return wrap;
  }

  function chosenNumber() {
    const select = document.getElementById('cr-number');
    const typed = document.getElementById('cr-typed');
    if (!select) return { error: 'No number selected.' };
    if (select.value === '__typed__') {
      const value = (typed.value || '').trim();
      if (!value) return { error: 'Enter a number in international format, starting with +.' };
      return { phone_typed: value };
    }
    return { phone_token: select.value };
  }

  function alertInline(message) {
    const body = document.getElementById('cr-body');
    const existing = body.querySelector('.cr-error');
    if (existing) existing.remove();
    body.prepend(el('div', 'cr-error', message));
  }

  // --- step 2: confirm -------------------------------------------------------

  async function propose(chosen) {
    busy('Preparing the call…');
    const response = await send({
      type: 'propose',
      thread: state.thread,
      // The finding itself, not its position. /analyze may have merged a model
      // finding into the list; the proposal endpoint runs rules only, so the
      // same index there can mean a different question. The server re-verifies
      // every part of this against the thread before it builds a call.
      finding: state.finding,
      recipient_name: state.analysis.counterparty,
      ...chosen,
    });
    if (!response.ok) return failure(response.error, () => showFindings([]));

    state.proposal = response.data;
    showConfirmation();
  }

  function showConfirmation() {
    const proposal = state.proposal;
    const nodes = [];

    if (proposal.will_dial_a_real_phone) {
      nodes.push(el('div', 'cr-warn',
        `This will place a real phone call to ${proposal.destination_masked}.`));
    } else {
      nodes.push(el('div', 'cr-good',
        'Fixture mode — every step runs exactly as it would live, except the dialling.'));
    }

    // Read from the proposal, not from the analysis: this is the question the
    // server verified and will actually put to a person.
    nodes.push(el('div', 'cr-label', 'It will ask'));
    nodes.push(el('div', 'cr-ask', proposal.finding.call_question));

    nodes.push(el('div', 'cr-label', 'What the caller is told to do'));
    const script = el('div', 'cr-quote');
    script.appendChild(document.createTextNode(proposal.task_preview));
    nodes.push(script);

    nodes.push(el('p', 'cr-hint',
      'It says it is an AI, asks only this, reads the answer back, and leaves no details ' +
      'on voicemail or with the wrong person.'));

    // One click. The button itself names the destination and says whether it
    // dials for real, so what you are agreeing to is on the control you press.
    const go = el('button', 'cr-btn',
      proposal.will_dial_a_real_phone
        ? `Call ${proposal.destination_masked} now`
        : `Place the call (fixture — dials nobody)`);
    go.addEventListener('click', () => place(proposal.confirm_token));
    nodes.push(go);

    const back = el('button', 'cr-btn cr-secondary', 'Back');
    back.addEventListener('click', () => showFindings([]));
    nodes.push(back);

    render(...nodes);
  }

  // --- step 3: place and wait ------------------------------------------------

  async function place(token) {
    busy('Dialling…');
    const response = await send({
      type: 'place',
      proposalId: state.proposal.proposal_id,
      confirm: token,
    });
    if (!response.ok) return failure(response.error);
    await waitForResult();
  }

  async function waitForResult() {
    for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
      const response = await send({ type: 'result', proposalId: state.proposal.proposal_id });
      if (!response.ok) return failure(response.error);

      const data = response.data;
      if (data.state === 'resolved' || data.state === 'unresolved') {
        return showResult(data);
      }
      busy('On the call — this usually takes about two minutes…');
      await sleep(POLL_INTERVAL_MS);
    }
    failure(
      'The call has not reported back yet. It may still be running — nothing further will be ' +
      'dialled for this question.'
    );
  }

  // --- step 4: result --------------------------------------------------------

  function showResult(data) {
    const nodes = [];

    if (data.state === 'resolved') {
      nodes.push(el('div', 'cr-good', `Settled: ${data.verdict.answer}`));
      if (data.verdict.quote) {
        const quote = el('div', 'cr-quote');
        quote.appendChild(el('span', 'cr-who', 'Their words'));
        quote.appendChild(document.createTextNode(data.verdict.quote));
        nodes.push(quote);
      }
      nodes.push(el('div', 'cr-label', 'Draft reply'));
      const draft = el('div', 'cr-draft');
      const textarea = el('textarea');
      textarea.id = 'cr-draft-body';
      textarea.value = data.draft.body;
      draft.appendChild(textarea);
      nodes.push(draft);

      const compose = el('button', 'cr-btn', 'Open in Gmail');
      compose.addEventListener('click', () => openCompose(data.draft.subject));
      nodes.push(compose);

      const copy = el('button', 'cr-btn cr-secondary', 'Copy the draft');
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(document.getElementById('cr-draft-body').value);
        copy.textContent = 'Copied';
      });
      nodes.push(copy);
      nodes.push(el('p', 'cr-hint', 'Nothing is sent. You review it and send it yourself.'));
    } else {
      nodes.push(el('div', 'cr-warn', data.draft.headline));
      const list = el('ul', 'cr-reasons');
      (data.verdict.reasons || []).forEach((reason) => list.appendChild(el('li', null, reason)));
      nodes.push(list);
      nodes.push(el('p', 'cr-hint', data.draft.suggestion));
    }

    if (data.transcript && data.transcript.length) {
      nodes.push(el('div', 'cr-label', 'What was said'));
      const transcript = el('div', 'cr-transcript');
      data.transcript.forEach((turn) => {
        const row = el('div', turn.speaker === 'user' ? 'cr-user' : null);
        row.appendChild(el('span', 'cr-at', `${turn.at}s`));
        row.appendChild(el('span', null, turn.text));
        transcript.appendChild(row);
      });
      nodes.push(transcript);
    }

    const done = el('button', 'cr-btn cr-secondary', 'Close');
    done.addEventListener('click', dismiss);
    nodes.push(done);

    render(...nodes);
  }

  function openCompose(subject) {
    const body = document.getElementById('cr-draft-body').value;
    const url = new URL('https://mail.google.com/mail/');
    url.searchParams.set('view', 'cm');
    url.searchParams.set('fs', '1');
    url.searchParams.set('su', subject || '');
    url.searchParams.set('body', body);
    window.open(url.toString(), '_blank', 'noopener');
  }

  // --- manual paste fallback -------------------------------------------------

  function pasteToggle() {
    const button = el('button', 'cr-btn cr-secondary', 'Paste a conversation instead');
    button.addEventListener('click', showPaste);
    return button;
  }

  function showPaste() {
    const nodes = [];
    nodes.push(el('p', 'cr-hint',
      'For when this page cannot be read automatically. One message per block, each opening ' +
      'with a name and a colon; label your own "Me:".'));

    const area = el('textarea');
    area.id = 'cr-paste';
    area.style.width = '100%';
    area.style.minHeight = '150px';
    area.placeholder = 'Me: Does Monday or Tuesday work?\nAlex: Yeah, I\'ll be there.\n+1 555 010 0142';
    nodes.push(area);

    const go = el('button', 'cr-btn', 'Check it');
    go.addEventListener('click', async () => {
      const parsed = readPasted(area.value, document.title || '');
      if (!parsed.ok) return alertInline(parsed.reason);
      await analyse(parsed.thread, []);
    });
    nodes.push(go);

    const back = el('button', 'cr-btn cr-secondary', 'Back');
    back.addEventListener('click', start);
    nodes.push(back);

    render(...nodes);
  }

  // --- boot ------------------------------------------------------------------

  // --- automatic pre-check ---------------------------------------------------

  let lastCheckedFingerprint = '';
  let checkTimer = null;

  /**
   * When a thread opens, ask the server whether anything looks unsettled — using
   * rules only. The model pass costs money and latency on every thread opened,
   * almost all of which are fine, so it is reserved for the full check you get
   * by clicking. Nothing here can place a call.
   */
  async function preCheck() {
    if (!document.getElementById('conversation-clarify-inline')
        && !document.getElementById('conversation-clarify-launcher')) return;
    if (document.getElementById(PANEL_ID)) return;   // the panel is already open

    const read = readThread(document);   // never expands; the pre-check must not touch the UI
    if (!read.ok) return markFinding(0);

    const response = await send({ type: 'analyze', thread: read.thread, rulesOnly: true });
    if (!response.ok) {
      // Stay quiet: nagging on every thread opened would be worse than useless.
      // Clear any previous mark so a stale badge cannot outlive the fact, and
      // leave the explanation for when the button is actually pressed.
      return markFinding(0);
    }
    markFinding((response.data.findings || []).length);
  }

  function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      const read = readThread(document);
      const fingerprint = read.ok
        ? read.thread.messages.map((m) => `${m.from_me}:${m.body.length}`).join('|')
        : '';
      if (fingerprint === lastCheckedFingerprint) return;
      lastCheckedFingerprint = fingerprint;
      markFinding(0);        // clear before re-checking; a stale badge is worse than none
      preCheck();
    }, 900);
  }

  function boot() {
    mountEntryPoints();
    scheduleCheck();
    // Gmail is a single page app: opening a thread replaces the DOM rather than
    // navigating, so the button has to be re-placed and the check re-run.
    new MutationObserver(() => {
      mountEntryPoints();
      scheduleCheck();
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) boot();
  else window.addEventListener('DOMContentLoaded', boot);
})();
