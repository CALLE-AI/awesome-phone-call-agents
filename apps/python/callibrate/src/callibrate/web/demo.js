/* The guided walkthrough at /?demo=1.
   The product drives itself: every click, every spotlight and every caption is
   the real console doing real work against the real API. Nothing is mocked.

   The script lives here, and one caption is one beat. `window.__CBR_TIMING`, if
   something injects it, paces each beat to a length of its own; without it the
   walkthrough estimates a readable pace and runs live. */

(() => {
  "use strict";

  if (!new URLSearchParams(window.location.search).has("demo")) return;

  const USERNAME = "judge";
  const PASSWORD = "callibrate-demo-2026";
  const GAP = 0.35; // the pause the console leaves between spoken turns

  const state = { failures: [], manifest: null, muted: false };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ------------------------------------------------------------- furniture */

  const caption = document.createElement("dialog");
  caption.className = "demo-caption";
  caption.popover = "manual";
  caption.innerHTML =
    '<span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round"><path d="M4 14V10"/><path d="M9 18V6"/><path d="M14 16v-8"/><path d="M20 15V9"/></svg></span><p></p>';

  const spotlight = document.createElement("dialog");
  spotlight.className = "demo-spotlight";
  spotlight.popover = "manual";

  const cursor = document.createElement("div");
  cursor.className = "demo-cursor";

  const card = document.createElement("dialog");
  card.className = "demo-card";
  card.popover = "manual";
  card.innerHTML = '<div class="demo-card-inner"></div>';

  document.body.append(caption, spotlight, cursor, card);
  // Both, on purpose: the root class scales the whole layout up for the film,
  // and the body class carries the walkthrough's own furniture.
  document.documentElement.classList.add("demo-running");
  document.body.classList.add("demo-running");

  // The first beat's card, and the cover the walkthrough opens behind.
  const OPENING = [
    "Callibrate calls the source.",
    "A directory tells you where help should be. Callibrate makes sure that is still true.",
  ];

  function say(text) {
    caption.querySelector("p").textContent = text;
    try {
      caption.showPopover();
    } catch {
      /* already open */
    }
  }

  function hideCaption() {
    try {
      caption.hidePopover();
    } catch {
      /* already closed */
    }
  }

  function showCard(title, body) {
    card.querySelector(".demo-card-inner").innerHTML =
      `<div class="rule"></div><h1>${title}</h1>${body ? `<p>${body}</p>` : ""}`;
    try {
      card.showPopover();
    } catch {
      /* already open */
    }
  }

  function showArchitectureCard() {
    const steps = [
      ["Trigger", "a stale record, a failed referral, or somebody asking"],
      ["Verification Contract", "what must be established, and what may change"],
      ["CALL-E", "plans, dials, and holds the conversation"],
      ["Call Evidence", "the transcript, read by rule"],
      ["Evidence policy", "deterministic; the model gets no vote"],
      ["The record, or a person", "and one ledger row either way"],
    ];
    card.querySelector(".demo-card-inner").innerHTML =
      '<div class="rule"></div><h1>One path, and nothing skips a step</h1>' +
      '<div class="demo-arch">' +
      steps
        .map(
          ([name, note], index) =>
            `<div class="demo-arch-step${index === 2 ? " calle" : ""}">` +
            `<b>${name}</b><span>${note}</span></div>` +
            (index < steps.length - 1 ? '<div class="demo-arch-arrow">&#8595;</div>' : ""),
        )
        .join("") +
      "</div>";
    try {
      card.showPopover();
    } catch {
      /* already open */
    }
  }

  function hideCard() {
    try {
      card.hidePopover();
    } catch {
      /* already closed */
    }
  }

  function clearSpotlight() {
    try {
      spotlight.hidePopover();
    } catch {
      /* already closed */
    }
    cursor.classList.remove("visible");
  }

  function highlight(selector) {
    const target = typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!target) return false;
    let box = target.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    // The caption rail owns the bottom of the window. Anything it would sit over
    // is scrolled clear of it first, or the ring is drawn around something
    // nobody watching can see. The page carries the room to do it: the demo
    // stylesheet pads the workspace and the public shell for exactly this.
    const floor = (caption.matches(":popover-open") ? caption.getBoundingClientRect().top : innerHeight) - 18;
    if (box.bottom > floor && box.height < floor - 18) {
      scrollBy(0, box.bottom - floor);
      box = target.getBoundingClientRect();
    }
    spotlight.style.top = `${box.top - 6}px`;
    spotlight.style.left = `${box.left - 6}px`;
    spotlight.style.width = `${box.width + 12}px`;
    spotlight.style.height = `${box.height + 12}px`;
    try {
      spotlight.showPopover();
    } catch {
      /* already open */
    }
    cursor.style.top = `${box.top + box.height / 2}px`;
    cursor.style.left = `${box.left + Math.min(box.width / 2, 140)}px`;
    cursor.classList.add("visible");
    return true;
  }

  async function waitFor(selector, timeout = 25000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const node = document.querySelector(selector);
      if (node) return node;
      await sleep(120);
    }
    throw new Error(`could not find ${selector}`);
  }

  async function click(selector) {
    const node = await waitFor(selector);
    highlight(node);
    await sleep(450);
    node.click();
    return node;
  }

  /* --------------------------------------------------------------- the call */

  async function loadManifest() {
    if (state.manifest) return state.manifest;
    try {
      state.manifest = await fetch("/assets/call/manifest.json").then((response) => response.json());
    } catch {
      state.manifest = null;
    }
    return state.manifest;
  }

  async function playCall(scenario, from, to) {
    const manifest = await loadManifest();
    if (!manifest) return;
    const turns = manifest[scenario].slice(from, to);
    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      window.callibrate.reveal(from + index + 1);
      say(`${turn.role === "assistant" ? "CALL-E" : "Provider"}: ${turn.text}`);
      if (!state.muted) {
        const audio = new Audio(`/assets/call/${turn.file}`);
        audio.play().catch(() => {});
      }
      // The transcript scrolls itself to the newest line on the next frame, so
      // measuring before that rings the box where the line used to be.
      await sleep(140);
      const lines = document.querySelectorAll(".transcript .turn");
      if (lines.length) highlight(lines[lines.length - 1]);
      await sleep((turn.seconds + GAP) * 1000);
    }
    clearSpotlight();
  }

  function callSeconds(scenario, from, to) {
    if (!state.manifest) return 12;
    return state.manifest[scenario]
      .slice(from, to)
      .reduce((total, turn) => total + turn.seconds + GAP, 0);
  }

  /* ------------------------------------------------------------------ beats */

  const script = [
    {
      caption:
        "Callibrate keeps a community directory true. It telephones the organisation with CALL-E, listens for proof that a value has changed, and corrects the listing only when the call proves it, so what somebody reads is what the provider just said.",
      run: async () => showCard(...OPENING),
    },
    {
      caption:
        "Here is one record it looks after. Meridian Community Pantry. Wednesdays, nine until twelve. Nobody has confirmed that with anybody for ninety-one days, and in June the pantry moved to ten until one.",
      run: async () => {
        hideCard();
        await window.callibrate.showPublicView();
        await waitFor(".result");
        highlight(".result .freshness");
      },
    },
    {
      caption:
        "So we ask. Pressing this turns the record into a Verification Contract: which fields are in doubt, what will count as evidence, and what the software may change afterwards without a person.",
      run: async () => {
        await click("[data-verify]");
        await waitFor(".verify-strip");
        // The strip grows as the call moves through its steps, and the results
        // list is repainted under it, so the ring is measured again rather than
        // left around the shape the strip used to be.
        for (let index = 0; index < 7; index += 1) {
          highlight(".verify-strip");
          await sleep(900);
        }
      },
    },
    {
      caption:
        "This is what CALL-E is given. Every line of it is generated from that contract: the disclosure, the rule that a new value has to be read back in full, and the four things that end the call immediately.",
      run: async () => {
        clearSpotlight();
        window.callibrate.showConsoleView();
        window.callibrate.setView("queue");
        await window.callibrate.loadConsole();
        await window.callibrate.selectTask("task_food");
        // Show the instruction first, then the call it produced.
        window.callibrate.state.lastRun = null;
        window.callibrate.render();
        await waitFor(".goal");
        highlight(".goal");
      },
    },
    {
      caption: "Then CALL-E phones the pantry.",
      run: async () => {
        clearSpotlight();
        window.__CBR_REVEAL = 0;
        window.callibrate.state.lastRun = await window.callibrate.api(
          "/api/tasks/task_food/run",
        );
        window.callibrate.state.job = {
          state: "calling",
          detail: "CALL-E is on the phone to the provider",
          caller: window.callibrate.state.lastRun.caller,
          call_id: window.callibrate.state.lastRun.call_id,
        };
        window.callibrate.render();
        await waitFor(".stage", 20000);
      },
    },
    {
      caption: null,
      call: ["hours_changed", 0, 7],
      run: async () => playCall("hours_changed", 0, 7),
    },
    {
      caption:
        "Here is the part that matters. The transcript has to contain three things, in order: the provider stating the value, the agent saying the whole of it back, and the provider agreeing without correcting. CALL-E does not get to assert any of them.",
      run: async () => {
        window.callibrate.state.job = null;
        window.callibrate.reveal(null);
        await waitFor(".check");
        highlight(".evidence");
      },
    },
    {
      caption:
        "All three are in the transcript, so the record changes. Nine to twelve becomes ten to one, applied automatically, carrying the two quotes it rests on.",
      run: async () => {
        highlight(".record-row");
        await sleep(500);
        highlight(".verdict");
      },
    },
    {
      caption:
        "Now the second call, and the boundary. Another provider, and a sentence no software should act on by itself.",
      run: async () => {
        clearSpotlight();
        window.__callibrateScenario = "program_closed";
        await window.callibrate.loadConsole();
        await window.callibrate.selectTask("task_legal");
        await waitFor("#call-button");
        window.__CBR_REVEAL = 1;
        await click("#call-button");
        await waitFor(".stage", 40000);
      },
    },
    {
      caption: null,
      call: ["program_closed", 1, 3],
      run: async () => playCall("program_closed", 1, 3),
    },
    {
      caption:
        "A closure. The automatic change is blocked, the listing is untouched, and it goes to a curator with the sentence that caused it.",
      run: async () => {
        window.callibrate.reveal(null);
        await sleep(400);
        highlight(".verdict");
        await sleep(1500);
        await click('.tab[data-view="decisions"]');
        await waitFor(".decision");
        highlight(".decision");
      },
    },
    {
      caption:
        "Both calls are in the same ledger: the contract, the CALL-E run, the transcript, the verdict and its reason, every row carrying the hash of the row before it.",
      run: async () => {
        clearSpotlight();
        await click('.tab[data-view="ledger"]');
        await waitFor(".event");
        highlight(".metric-strip");
      },
    },
    {
      caption:
        "That is the whole product. A trigger becomes a contract, CALL-E holds the conversation, and deterministic software decides what the conversation was allowed to change.",
      run: async () => {
        clearSpotlight();
        hideCaption();
        showArchitectureCard();
      },
    },
    {
      caption:
        "Databases drift. Callibrate calls the source, and brings the record back to reality.",
      run: async () =>
        showCard(
          "Databases drift.",
          "Callibrate calls the source and brings the record back to reality.",
        ),
    },
  ];

  /* ----------------------------------------------------------------- runner */

  function estimate(beat) {
    if (beat.call) return callSeconds(beat.call[0], beat.call[1], beat.call[2]) + 1.2;
    return Math.max(3.2, (beat.caption || "").length / 15) + 0.8;
  }

  async function play() {
    state.muted = window.__CBR_MUTE_CALL === true;
    await loadManifest();

    await waitFor("#login-form");
    await window.callibrate.signIn(USERNAME, PASSWORD);
    await waitFor(".rig");

    const timing = Array.isArray(window.__CBR_TIMING) ? window.__CBR_TIMING : null;
    for (let index = 0; index < script.length; index += 1) {
      const beat = script[index];
      const budget = (timing ? timing[index] : estimate(beat)) * 1000;
      const started = performance.now();
      if (beat.caption) say(beat.caption);
      else hideCaption();
      try {
        await beat.run();
      } catch (error) {
        state.failures.push(`beat ${index + 1}: ${error.message}`);
        console.warn(`demo beat ${index + 1} failed: ${error.message}`);
      }
      const remaining = budget - (performance.now() - started);
      if (remaining > 0) await sleep(remaining);
    }
    clearSpotlight();
    hideCaption();
    window.callibrateDemo.finished = true;
    window.__CBR_DEMO_COMPLETE = true;
  }

  window.callibrateDemo = {
    script: script.map((beat) => ({ caption: beat.caption, call: beat.call || null })),
    failures: state.failures,
    finished: false,
    play,
  };

  // Up before the first beat, and before the sign-in the walkthrough drives
  // itself through: a recording that opens earlier than beat one catches the
  // title card rather than the console flashing past.
  showCard(...OPENING);

  if (window.__CBR_DEMO_MANUAL !== true) {
    window.addEventListener("load", () => setTimeout(play, 400));
  }
})();
