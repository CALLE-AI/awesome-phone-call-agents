/* Muster console.
   Three views, one hash route, no framework. The API is read-only and the
   console never decides anything: every grade shown here was computed by
   muster/grading.py and is reproduced verbatim. */

(function () {
  "use strict";

  var state = {
    roster: null,
    scenarios: {},
    grades: {},
    current: null,
    subjectId: null,
    busy: false
  };

  /* Kept in step with coaching.LONG_PAUSE_SECONDS. The console only annotates
     the pause; whether it counts is settled server side. */
  var LONG_PAUSE_SECONDS = 6;

  var GRADE_WORDS = {
    CONFIRMED_LIVE: "Confirmed live",
    PRESUMED_LIVE_WEAK: "Presumed live, weak",
    THIRD_PARTY_CLAIM: "Third party claim",
    UNPROVEN: "Unproven",
    CONTRA: "Contra",
    NEEDS_HUMAN: "Needs human"
  };

  var GRADE_GLOSS = {
    CONFIRMED_LIVE:
      "The subject answered for themselves, repeated a challenge minted "
      + "seconds earlier, and answered a question a housemate could not. "
      + "This is the only grade that closes without a person.",
    PRESUMED_LIVE_WEAK:
      "Somebody was reached and did answer, but one leg of the protocol came "
      + "up short. It is not a confirmation, and it is not filed as one.",
    THIRD_PARTY_CLAIM:
      "Another person vouched for the subject. A vouching is a statement "
      + "about somebody who was not on the call, which is no evidence of "
      + "life at all. This is the shape the Kato case took.",
    UNPROVEN:
      "The call established nothing in either direction. That is the honest "
      + "reading of it, and it is the one entered in the register.",
    CONTRA:
      "Something heard on the call contradicts the enrolment record. This is "
      + "not a finding of death. No grade in this register concludes one.",
    NEEDS_HUMAN:
      "This call is not for a machine to settle. A person picks it up, and "
      + "the subject is not failed while they wait."
  };

  var REASON_WORDS = {
    enrolled_accessibility_route:
      "Enrolled accessibility route - never failed by machine",
    not_reached_voicemail: "Not reached: voicemail answered",
    not_reached_ivr: "Not reached: automated menu answered",
    not_reached_no_answer: "Not reached: nobody answered",
    not_reached_unknown: "Not reached: endpoint unclear",
    line_may_be_reassigned: "The line may have been reassigned",
    death_reported_requires_human_verification:
      "A death was reported - requires human verification",
    third_party_vouched_not_evidence_of_life:
      "A third party vouched - not evidence of life",
    distress_or_confusion_heard: "Distress or confusion heard on the call",
    coaching_suspected: "Coaching suspected",
    unattributed_voice_between_question_and_answer:
      "An unattributed voice sat between question and answer",
    no_self_identification_under_disclosure:
      "No self-identification under disclosure",
    freshness_challenge_failed: "Freshness challenge failed",
    freshness_challenge_passed: "Freshness challenge passed",
    no_knowledge_prompts_enrolled: "No knowledge prompts enrolled",
    no_co_resident_safe_prompt_passed:
      "No co-resident safe prompt passed - impersonation stays open",
    self_identified: "Self-identified under disclosure"
  };

  /* ------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function gradeWord(grade) {
    return GRADE_WORDS[grade] || String(grade || "").replace(/_/g, " ");
  }

  function reasonWord(reason) {
    if (REASON_WORDS[reason]) { return REASON_WORDS[reason]; }
    var partial = /^knowledge_challenge_partial_(\d+)_of_(\d+)$/.exec(reason);
    if (partial) {
      return "Knowledge challenge partial - " + partial[1] + " of "
        + partial[2] + " answered";
    }
    var passed = /^knowledge_challenge_passed_(\d+)_of_(\d+)$/.exec(reason);
    if (passed) {
      return "Knowledge challenge passed - " + passed[1] + " of "
        + passed[2];
    }
    var delayed = /^reply_delayed_more_than_(\d+)s$/.exec(reason);
    if (delayed) {
      return "Reply delayed more than " + delayed[1] + " seconds";
    }
    var words = String(reason).replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function scenarioWord(name) {
    var words = String(name || "").replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function stamp(seconds) {
    var total = Number(seconds) || 0;
    var mins = Math.floor(total / 60);
    var rest = total - mins * 60;
    var padded = rest < 10 ? "0" + rest.toFixed(1) : rest.toFixed(1);
    return mins + ":" + padded;
  }

  function fault(message) {
    var box = $("fault");
    if (!message) {
      box.hidden = true;
      box.textContent = "";
      return;
    }
    box.hidden = false;
    box.textContent = message;
  }

  function getJSON(url) {
    return fetch(url, { headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.text().then(function (body) {
          var parsed = null;
          try { parsed = JSON.parse(body); } catch (error) { parsed = null; }
          if (!response.ok) {
            var detail = parsed && parsed.error
              ? parsed.error
              : response.status + " " + response.statusText;
            throw new Error(detail);
          }
          if (parsed === null) {
            throw new Error("the response was not JSON: " + body.slice(0, 120));
          }
          return parsed;
        });
      });
  }

  /* -------------------------------------------------------- routing */

  function route() {
    var hash = window.location.hash || "#/register";
    var attest = /^#\/attestation\/([^/?#]+)/.exec(hash);
    if (attest) { return { view: "attestation", subject: decodeURIComponent(attest[1]) }; }
    if (hash.indexOf("#/attestation") === 0) { return { view: "attestation", subject: null }; }
    if (hash.indexOf("#/protocol") === 0) { return { view: "protocol", subject: null }; }
    return { view: "register", subject: null };
  }

  function show(view) {
    ["register", "attestation", "protocol"].forEach(function (name) {
      $("view-" + name).hidden = name !== view;
    });
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i += 1) {
      if (tabs[i].getAttribute("data-tab") === view) {
        tabs[i].setAttribute("aria-current", "page");
      } else {
        tabs[i].removeAttribute("aria-current");
      }
    }
  }

  function onRoute() {
    var here = route();
    show(here.view);
    if (here.view !== "attestation") { return; }
    if (!here.subject) {
      if (state.current) {
        renderAttestation(state.current);
      } else {
        $("attestation-empty").hidden = false;
        $("attestation-body").hidden = true;
      }
      return;
    }
    if (state.current && state.current.subject_id === here.subject) {
      renderAttestation(state.current);
      return;
    }
    attest(here.subject, null);
  }

  /* ------------------------------------------------------- register */

  function loadRoster() {
    return getJSON("/api/roster").then(function (data) {
      state.roster = data;
      state.scenarios = data.scenarios || {};
      $("scheme-name").textContent = data.scheme || "-";
      $("cycle-name").textContent = data.cycle || "-";
      renderRegister();
      fault(null);
    }).catch(function (error) {
      fault("The register could not be read: " + error.message
        + ". Confirm the Muster API is serving on this origin.");
      $("register-body").innerHTML =
        '<tr><td colspan="8" class="waiting">Unavailable.</td></tr>';
    });
  }

  function renderRegister() {
    if (!state.roster) { return; }
    var rows = state.roster.subjects.map(function (subject, index) {
      var grade = state.grades[subject.subject_id];
      var last = grade
        ? '<span class="grade-tag" data-grade="' + esc(grade) + '">'
          + esc(gradeWord(grade)) + "</span>"
        : '<span class="no-grade">not yet attested</span>';
      var route = subject.needs_human_path
        ? '<span class="route-human">human</span>'
        : '<span class="route-auto">standard</span>';
      return '<tr class="entry" tabindex="0" role="link" data-subject="'
        + esc(subject.subject_id) + '">'
        + '<td class="col-no">' + (index + 1) + "</td>"
        + '<td class="entry-name">' + esc(subject.display_name)
        + '<span class="chevron">&rarr;</span></td>'
        + '<td class="mono-cell">' + esc(subject.reference) + "</td>"
        + "<td>" + esc(subject.country_code) + "</td>"
        + "<td>" + esc(subject.language) + "</td>"
        + '<td class="col-num">' + esc(subject.prompt_count) + "</td>"
        + "<td>" + route + "</td>"
        + "<td>" + last + "</td>"
        + "</tr>";
    });
    $("register-body").innerHTML = rows.join("")
      || '<tr><td colspan="8" class="waiting">Nobody is enrolled.</td></tr>';
  }

  /* ---------------------------------------------------- attestation */

  function attest(subjectId, scenario) {
    if (state.busy) { return; }
    state.busy = true;
    state.subjectId = subjectId;
    show("attestation");
    $("attestation-empty").hidden = true;
    $("attestation-body").hidden = false;
    $("attestation-body").innerHTML =
      '<p class="back-line"><a class="plain-link" href="#/register">'
      + "&larr; Register</a></p>"
      + '<div class="sheet"><h2>Placing the call</h2>'
      + '<p class="lede">Minting the freshness challenge, drawing the '
      + "prompts, then grading what came back.</p></div>";

    var url = "/api/attest?subject=" + encodeURIComponent(subjectId);
    if (scenario) { url += "&scenario=" + encodeURIComponent(scenario); }

    getJSON(url).then(function (data) {
      state.busy = false;
      state.current = data;
      state.grades[data.subject_id] = data.grade;
      renderRegister();
      fault(null);
      renderAttestation(data);
      if (window.location.hash.indexOf("#/attestation/" + subjectId) !== 0) {
        window.location.hash = "#/attestation/" + encodeURIComponent(subjectId);
      }
    }).catch(function (error) {
      state.busy = false;
      fault("The attestation could not be run: " + error.message);
      $("attestation-body").innerHTML =
        '<p class="back-line"><a class="plain-link" href="#/register">'
        + "&larr; Register</a></p>"
        + '<div class="sheet"><h2>Nothing to record</h2>'
        + '<p class="lede">The call could not be placed against the API, so '
        + "there is no attestation to show. The fault is quoted above.</p>"
        + "</div>";
    });
  }

  function renderAttestation(data) {
    $("attestation-empty").hidden = true;
    $("attestation-body").hidden = false;
    $("attestation-body").innerHTML = [
      '<p class="back-line"><a class="plain-link" href="#/register">'
      + "&larr; Register</a></p>",
      recordHead(data),
      verdict(data),
      scenarioPicker(data),
      reasonsBlock(data),
      challengeBlock(data),
      coachingBlock(data),
      quotesBlock(data),
      transcriptBlock(data),
      disclosureBlock(data)
    ].join("");

    var picker = $("scenario-select");
    if (picker) {
      picker.addEventListener("change", function () {
        attest(data.subject_id, picker.value);
      });
    }
  }

  function recordHead(data) {
    return '<div class="record-head">'
      + "<h2>" + esc(data.display_name) + "</h2>"
      + '<p class="record-ids">'
      + "<span>" + esc(data.subject_id) + "</span>"
      + "<span>line " + esc(data.masked_phone) + "</span>"
      + "<span>cycle " + esc(state.roster ? state.roster.cycle : "") + "</span>"
      + "</p></div>";
  }

  function verdict(data) {
    var challenges = esc(data.challenges_passed) + " of "
      + esc(data.challenges_asked);
    var nonce = data.nonce_ok === true
      ? "passed"
      : (data.nonce_ok === false ? "failed" : "not put");
    return '<section class="verdict" data-grade="' + esc(data.grade) + '">'
      + '<p class="verdict-label">Grade recorded</p>'
      + '<p class="verdict-grade">' + esc(gradeWord(data.grade)) + "</p>"
      + '<p class="verdict-gloss">' + esc(GRADE_GLOSS[data.grade] || "") + "</p>"
      + '<dl class="verdict-facts">'
      + "<div><dt>Closes automatically</dt><dd class=\""
      + (data.auto_closes ? "affirm" : "deny") + '">'
      + (data.auto_closes ? "yes" : "no - a person picks this up")
      + "</dd></div>"
      + "<div><dt>Freshness</dt><dd>" + nonce + "</dd></div>"
      + "<div><dt>Knowledge</dt><dd>" + challenges + "</dd></div>"
      + "<div><dt>Coaching</dt><dd>"
      + (data.coaching_suspected ? "suspected" : "not suspected")
      + "</dd></div>"
      + "<div><dt>Payment</dt><dd>"
      + (data.stops_payment ? "stopped" : "untouched") + "</dd></div>"
      + "</dl>"
      + '<p class="never-stops">This never stops a payment.</p>'
      + "</section>";
  }

  function scenarioPicker(data) {
    var names = Object.keys(state.scenarios);
    if (!names.length) { return ""; }
    var options = names.map(function (name) {
      return '<option value="' + esc(name) + '"'
        + (name === data.scenario ? " selected" : "") + ">"
        + esc(scenarioWord(name)) + "</option>";
    }).join("");
    var note = state.scenarios[data.scenario] || "";
    return '<div class="scenario">'
      + '<label for="scenario-select">Run the same call as</label>'
      + '<select id="scenario-select">' + options + "</select>"
      + '<p class="scenario-note">' + esc(note) + "</p>"
      + "</div>";
  }

  function reasonsBlock(data) {
    var reasons = data.reasons || [];
    if (!reasons.length) { return ""; }
    var chips = reasons.map(function (reason) {
      return '<span class="chip" data-grade="' + esc(data.grade) + '" title="'
        + esc(reason) + '">' + esc(reasonWord(reason)) + "</span>";
    }).join("");
    return '<section class="record-section">'
      + "<h3>Named reasons</h3>"
      + '<div class="chips">' + chips + "</div>"
      + "</section>";
  }

  function challengeBlock(data) {
    var challenge = data.challenge || { words: [], weekday: "" };
    var words = (challenge.words || []).map(function (word, index) {
      return "<li><b>" + (index + 1) + "</b>" + esc(word) + "</li>";
    }).join("");
    var prompts = (data.prompts || []).map(function (prompt) {
      var mark = prompt.co_resident_safe
        ? '<span class="safe">co-resident safe</span>'
        : '<span class="unsafe">a housemate might know this</span>';
      return "<li>"
        + '<span class="prompt-q">' + esc(prompt.question) + "</span>"
        + '<span class="prompt-meta">' + esc(prompt.prompt_id)
        + " &middot; " + mark + "</span>"
        + "</li>";
    }).join("");
    if (!prompts) {
      prompts = '<li><span class="no-grade">No prompts were enrolled for '
        + "this subject.</span></li>";
    }
    return '<section class="record-section">'
      + "<h3>What was put to them</h3>"
      + '<div class="two-up">'
      + '<div class="panel"><h4>Freshness challenge issued</h4>'
      + '<ul class="nonce-words">' + words + "</ul>"
      + '<p class="nonce-weekday">and the day of the week today, which was '
      + "<strong>" + esc(challenge.weekday) + "</strong>. A recording cannot "
      + "answer either half.</p></div>"
      + '<div class="panel"><h4>Knowledge prompts drawn</h4>'
      + '<ul class="prompt-list">' + prompts + "</ul></div>"
      + "</div></section>";
  }

  function coachingBlock(data) {
    if (!data.coaching_suspected) { return ""; }
    return '<div class="warn">'
      + "<h4>Coaching suspected</h4>"
      + "<p>The turn timing suggests somebody in the room supplied the "
      + "answers. This is a heuristic and it may only ever downgrade a "
      + "result. It never concludes fraud, and it never raises a grade. "
      + "Look for the unattributed turns in the transcript below.</p>"
      + "</div>";
  }

  function quotesBlock(data) {
    var quotes = data.evidence_quotes || [];
    if (!quotes.length) { return ""; }
    var items = quotes.map(function (quote) {
      return "<li>" + esc(quote) + "</li>";
    }).join("");
    return '<section class="record-section">'
      + "<h3>Evidence quoted</h3>"
      + '<ul class="quotes">' + items + "</ul>"
      + "</section>";
  }

  function transcriptBlock(data) {
    var turns = data.transcript || [];
    if (!turns.length) {
      return '<section class="record-section"><h3>Transcript</h3>'
        + '<p class="no-grade">No turns were returned for this call.</p>'
        + "</section>";
    }
    /* The pause is measured from the most recent question, not the adjacent
       turn, because an intervening voice is the very thing being looked for.
       This mirrors coaching.long_gap_before_reply. */
    var askedAt = null;
    var rows = turns.map(function (turn) {
      var speaker = turn.speaker || "unknown";
      var flag = speaker === "unknown"
        ? '<p class="turn-flag">Unattributed &mdash; this is the coaching '
          + "signal</p>"
        : "";
      var gap = "";
      if (speaker === "bot") {
        askedAt = Number(turn.offset_seconds);
      } else if (speaker === "user" && askedAt !== null) {
        var delay = Number(turn.offset_seconds) - askedAt;
        askedAt = null;
        if (delay > LONG_PAUSE_SECONDS) {
          gap = '<p class="gap-note">' + delay.toFixed(1)
            + " seconds after the question was put</p>";
        }
      }
      return '<div class="turn" data-speaker="' + esc(speaker) + '">'
        + '<span class="turn-at">' + esc(stamp(turn.offset_seconds)) + "</span>"
        + '<span class="turn-who">' + esc(speaker) + "</span>"
        + '<span class="turn-text">' + esc(turn.text) + "</span>"
        + flag + gap
        + "</div>";
    }).join("");
    return '<section class="record-section">'
      + "<h3>Transcript</h3>"
      + '<div class="transcript">' + rows + "</div>"
      + "</section>";
  }

  function redactNumbers(text) {
    /* The task text carries the number in full. Muster's own rule is that a
       full number never reaches a preview or a log, so it never reaches the
       console either. */
    return String(text).replace(/\+\d{7,}/g, function (found) {
      return found.slice(0, 4) + "******" + found.slice(-3);
    });
  }

  function disclosureBlock(data) {
    if (!data.task_text) { return ""; }
    return '<section class="record-section">'
      + "<h3>Disclosure read on the call</h3>"
      + '<div class="panel"><p class="disclosure">'
      + esc(redactNumbers(data.task_text))
      + "</p></div>"
      + '<p class="foot-note">Read before anything is asked. The number is '
      + "masked here, as it is in every Muster preview and log.</p>"
      + "</section>";
  }

  /* -------------------------------------------------------- wiring */

  document.addEventListener("click", function (event) {
    var row = event.target.closest ? event.target.closest("tr.entry") : null;
    if (!row) { return; }
    window.location.hash = "#/attestation/"
      + encodeURIComponent(row.getAttribute("data-subject"));
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") { return; }
    var row = event.target.closest ? event.target.closest("tr.entry") : null;
    if (!row) { return; }
    event.preventDefault();
    window.location.hash = "#/attestation/"
      + encodeURIComponent(row.getAttribute("data-subject"));
  });

  window.addEventListener("hashchange", onRoute);

  loadRoster().then(onRoute);
}());
