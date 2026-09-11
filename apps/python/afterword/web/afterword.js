/* Afterword console.
   Four views over a read-only API. No framework, no build, no external script.
   Nothing here decides anything: every grade, every dispute and every refusal
   is computed server side, and this file only reads them out in plain words. */

(function () {
  "use strict";

  var view = document.getElementById("view");
  var nav = document.getElementById("nav");

  var cache = { estate: null, pack: null, captures: {} };

  /* ---- fetching -------------------------------------------------------- */

  function getJSON(path) {
    return fetch(path, { headers: { Accept: "application/json" } }).then(
      function (response) {
        if (!response.ok) {
          throw new Error(
            "the server answered " + response.status + " for " + path
          );
        }
        return response.json();
      }
    );
  }

  function estate() {
    if (cache.estate) {
      return Promise.resolve(cache.estate);
    }
    return getJSON("/api/estate").then(function (data) {
      cache.estate = data;
      return data;
    });
  }

  function pack() {
    if (cache.pack) {
      return Promise.resolve(cache.pack);
    }
    return getJSON("/api/pack").then(function (data) {
      cache.pack = data;
      return data;
    });
  }

  function capture(institutionId, scenario) {
    var key = institutionId + "/" + (scenario || "");
    if (cache.captures[key]) {
      return Promise.resolve(cache.captures[key]);
    }
    var path = "/api/capture?institution=" + encodeURIComponent(institutionId);
    if (scenario) {
      path += "&scenario=" + encodeURIComponent(scenario);
    }
    return getJSON(path).then(function (data) {
      cache.captures[key] = data;
      return data;
    });
  }

  /* ---- words ----------------------------------------------------------- */

  var GRADE_WORDS = {
    REQUIREMENTS_CAPTURED: "Requirements captured",
    PARTIAL: "Partly answered",
    DISPUTED: "Two answers on record",
    REFERRED: "Executor must call himself",
    UNREACHED: "Nobody reached"
  };

  /* The same grade, counted rather than named, so a tally line reads as a
     sentence instead of repeating the label after the number. */
  var TALLY_WORDS = {
    REQUIREMENTS_CAPTURED: "captured in full",
    PARTIAL: "partly answered",
    DISPUTED: "with two answers on record",
    REFERRED: "waiting on the executor",
    UNREACHED: "never reached"
  };

  var KIND_WORDS = {
    bank: "Bank",
    pension: "Pension",
    insurer: "Insurer",
    utility: "Utility",
    mobile: "Mobile provider",
    council: "Council",
    subscription: "Subscription"
  };

  var CERTIFIED_WORDS = {
    yes: "Yes. A certified copy is accepted.",
    no: "No. They asked for the original certificate.",
    unknown: "They did not say."
  };

  var DEBIT_WORDS = {
    continue: "Payments carry on for now.",
    cancelled_on_notification: "Cancelled as soon as they are told.",
    frozen: "The account is frozen, so nothing goes out.",
    executor_must_instruct: "Nothing changes until the executor instructs them.",
    unknown: "They did not say."
  };

  var FIELD_WORDS = {
    department: "Department",
    documents_needed: "Documents needed",
    certified_copy_accepted: "Certified copy accepted",
    direct_debits_action: "Direct debits"
  };

  var FIELD_QUESTIONS = {
    department: "Which team handles a reported death?",
    documents_needed: "What must the family send?",
    certified_copy_accepted: "Will a certified copy do?",
    direct_debits_action: "What happens to the direct debits meanwhile?"
  };

  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function gradeWord(grade) {
    return GRADE_WORDS[grade] || grade;
  }

  function kindWord(kind) {
    return KIND_WORDS[kind] || kind;
  }

  function fieldWord(name) {
    return FIELD_WORDS[name] || name.replace(/_/g, " ");
  }

  function longDate(iso) {
    var parts = String(iso).split("-");
    if (parts.length !== 3) {
      return iso;
    }
    var month = MONTHS[Number(parts[1]) - 1] || parts[1];
    return Number(parts[2]) + " " + month + " " + parts[0];
  }

  function stampDay(iso) {
    if (!iso) {
      return "";
    }
    return longDate(String(iso).slice(0, 10));
  }

  function latestCapture(entries) {
    var latest = "";
    (entries || []).forEach(function (entry) {
      if (entry.captured_at && entry.captured_at > latest) {
        latest = entry.captured_at;
      }
    });
    return latest;
  }

  function reasonWord(reason) {
    if (reason.indexOf("unanswered_") === 0) {
      return "Unanswered: " + fieldWord(reason.slice(11)).toLowerCase();
    }
    if (reason.indexOf("conflict_") === 0) {
      return "Conflict: " + fieldWord(reason.slice(9)).toLowerCase();
    }
    if (reason.indexOf("documents_named_") === 0) {
      var count = reason.slice(16);
      return count + (count === "1" ? " document named" : " documents named");
    }
    if (reason.indexOf("not_reached_") === 0) {
      var how = reason.slice(12);
      if (how === "ivr_dead_end") {
        return "Automated menu with no route to a person";
      }
      return "Not reached: " + how.replace(/_/g, " ");
    }
    if (reason === "institution_will_speak_only_to_named_executor") {
      return "Will speak only to the named executor";
    }
    return reason.charAt(0).toUpperCase() + reason.slice(1).replace(/_/g, " ");
  }

  /* A conflict's source, said the way a person would say it. */
  function sourceWord(source) {
    if (source === "this_call") {
      return "What the adviser said on this call.";
    }
    if (source.indexOf("recorded_policy:") === 0) {
      return "The institution's own published policy: " + source.slice(16) + ".";
    }
    if (source.indexOf("prior_call:") === 0) {
      var bits = source.slice(11).split(":");
      var when = bits.length > 1 ? longDate(bits[1]) : "";
      return (
        "An earlier call to the same institution" +
        (when ? ", " + when : "") +
        " (" + bits[0] + ")."
      );
    }
    return source;
  }

  function sourceHeading(source) {
    if (source === "this_call") {
      return "This call said";
    }
    if (source.indexOf("recorded_policy:") === 0) {
      return "Their own policy says";
    }
    if (source.indexOf("prior_call:") === 0) {
      return "The earlier call said";
    }
    return source;
  }

  function answerHTML(field, value) {
    if (field === "documents_needed") {
      var items = String(value)
        .split(";")
        .map(function (part) {
          return part.trim();
        })
        .filter(Boolean);
      return (
        "<ul>" +
        items
          .map(function (item) {
            return "<li>" + esc(item) + "</li>";
          })
          .join("") +
        "</ul>"
      );
    }
    if (field === "certified_copy_accepted") {
      return esc(CERTIFIED_WORDS[value] || value);
    }
    if (field === "direct_debits_action") {
      return esc(DEBIT_WORDS[value] || value);
    }
    return esc(value);
  }

  /* The rounded tile that opens every card. Its letter is the institution's
     own initial, tinted by kind, and it carries no information a screen
     reader is not already given by the heading beside it. */
  function tileHTML(kind, name) {
    var letter = String(name || "").trim().charAt(0).toUpperCase();
    return (
      '<span class="tile" data-kind="' +
      esc(kind) +
      '" aria-hidden="true">' +
      esc(letter || "?") +
      "</span>"
    );
  }

  function initials(name) {
    var words = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) {
      return "AW";
    }
    var last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
    return (words[0].charAt(0) + last).toUpperCase();
  }

  var FLAG_ICON =
    '<svg class="ico" viewBox="0 0 16 16" fill="currentColor" ' +
    'aria-hidden="true"><path d="m8 1.6 1.9 4 4.4.6-3.2 3.1.8 4.3L8 11.6 ' +
    '4.1 13.6l.8-4.3L1.7 6.2l4.4-.6z"/></svg>';

  function gradeHTML(grade) {
    return (
      '<p class="grade" data-grade="' +
      esc(grade) +
      '"><span class="dot" aria-hidden="true"></span>' +
      esc(gradeWord(grade)) +
      "</p>"
    );
  }

  function errorHTML(error, what) {
    return (
      '<div class="fetch-error" role="alert"><p><strong>' +
      esc(what) +
      " could not be loaded.</strong> Nothing on this page is out of date, " +
      "because nothing loaded at all.</p><p class=\"mono\">" +
      esc(error && error.message ? error.message : String(error)) +
      "</p><p>Check that the Afterword server is still running, then reload " +
      "this page.</p></div>"
    );
  }

  /* ---- view 1: the pack ------------------------------------------------ */

  var STILL_NEEDS = { REFERRED: true, UNREACHED: true };

  function packEntryHTML(entry) {
    var requirement = entry.requirement;
    var rows = [];

    if (entry.captured_at) {
      rows.push(["Asked on", esc(stampDay(entry.captured_at))]);
    }
    if (requirement && requirement.department) {
      rows.push(["Department", esc(requirement.department)]);
    }
    if (requirement && requirement.documents_needed.length) {
      rows.push([
        "Documents needed",
        '<ul class="checklist">' +
          requirement.documents_needed
            .map(function (doc) {
              return "<li>" + esc(doc) + "</li>";
            })
            .join("") +
          "</ul>"
      ]);
    }
    if (requirement) {
      rows.push([
        "Certified copy",
        esc(
          CERTIFIED_WORDS[requirement.certified_copy_accepted] ||
            requirement.certified_copy_accepted
        )
      ]);
      rows.push([
        "Direct debits",
        esc(
          DEBIT_WORDS[requirement.direct_debits_action] ||
            requirement.direct_debits_action
        )
      ]);
      rows.push([
        "Reference opened",
        requirement.reference_opened
          ? "<code>" + esc(requirement.reference_opened) + "</code>"
          : '<span class="quiet">None yet. Many institutions open one only ' +
            "when the paperwork arrives.</span>"
      ]);
    }

    var notes = "";
    if (entry.grade === "DISPUTED") {
      notes +=
        '<div class="aside-note warn"><p>The answers above are one of two ' +
        "versions on record. Afterword has not chosen between them. Read " +
        'both sides under <a href="#/disputes">Disputes</a> before you post ' +
        "anything to this institution.</p></div>";
    }
    if (entry.grade === "PARTIAL" && requirement && requirement.missing.length) {
      notes +=
        '<div class="aside-note wait"><p>Still unanswered: ' +
        esc(
          requirement.missing
            .map(function (name) {
              return fieldWord(name).toLowerCase();
            })
            .join(", ")
        ) +
        ". Nobody guessed at these.</p></div>";
    }
    if (entry.grade === "REFERRED") {
      notes +=
        '<div class="aside-note"><p>They will discuss this only with ' +
        "the named executor. That is a proper refusal, not a failure, and " +
        "Afterword did not try to talk its way past it.</p></div>";
    }
    if (entry.grade === "UNREACHED") {
      notes +=
        '<div class="aside-note"><p>No person was reached, so nothing was ' +
        "established. An automated menu is not an answer about documents." +
        "</p></div>";
    }
    if (entry.evidence_quotes.length && STILL_NEEDS[entry.grade]) {
      notes +=
        '<div class="section"><span class="label">In their words</span>' +
        '<ul class="quotes">' +
        entry.evidence_quotes
          .map(function (quote) {
            return "<li>" + esc(quote) + "</li>";
          })
          .join("") +
        "</ul></div>";
    }

    return (
      '<section class="entry">' +
      '<div class="entry-head">' +
      tileHTML(entry.kind, entry.institution) +
      '<div class="entry-head-text"><h3>' +
      esc(entry.institution) +
      "</h3>" +
      '<p class="entry-line"><span>' +
      esc(kindWord(entry.kind)) +
      '</span><span class="sep">' +
      esc(entry.masked_phone) +
      "</span></p>" +
      gradeHTML(entry.grade) +
      "</div></div>" +
      (rows.length
        ? '<dl class="fields">' +
          rows
            .map(function (row) {
              return "<dt>" + esc(row[0]) + "</dt><dd>" + row[1] + "</dd>";
            })
            .join("") +
          "</dl>"
        : "") +
      notes +
      "</section>"
    );
  }

  function tallyHTML(counts) {
    var order = [
      "REQUIREMENTS_CAPTURED",
      "DISPUTED",
      "PARTIAL",
      "REFERRED",
      "UNREACHED"
    ];
    return order
      .filter(function (grade) {
        return counts[grade];
      })
      .map(function (grade) {
        return (
          '<span class="grade" data-grade="' +
          grade +
          '"><span class="dot" aria-hidden="true"></span>' +
          counts[grade] +
          " " +
          esc(TALLY_WORDS[grade] || gradeWord(grade).toLowerCase()) +
          "</span>"
        );
      })
      .join('<span aria-hidden="true">&nbsp; &nbsp;</span>');
  }

  function renderPack() {
    view.innerHTML = '<p class="loading">Assembling the pack.</p>';
    Promise.all([pack(), estate()])
      .then(function (both) {
        var data = both[0];
        var est = both[1];
        var main = data.entries.filter(function (entry) {
          return !STILL_NEEDS[entry.grade];
        });
        var tail = data.entries.filter(function (entry) {
          return STILL_NEEDS[entry.grade];
        });

        view.innerHTML =
          '<article class="pack">' +
          '<header class="pack-head">' +
          '<p class="label pack-kicker">Consolidated requirements pack</p>' +
          "<h1>The estate of " +
          esc(data.deceased_name) +
          "</h1>" +
          '<dl class="pack-meta">' +
          "<dt>Executor</dt><dd>" +
          esc(est.executor_name) +
          "</dd>" +
          "<dt>Family reference</dt><dd><code>" +
          esc(est.reference) +
          "</code></dd>" +
          "<dt>Estate</dt><dd><code>" +
          esc(data.estate_id) +
          "</code></dd>" +
          "<dt>Institutions called</dt><dd>" +
          data.entries.length +
          "</dd>" +
          "<dt>Last call placed</dt><dd>" +
          esc(stampDay(latestCapture(data.entries)) || "no calls recorded") +
          "</dd>" +
          "</dl>" +
          '<p class="pack-standing">Everything below is what somebody at the ' +
          "institution said on the telephone, quoted and dated. None of it " +
          "is binding on them, and none of it has been acted on. No account " +
          "has been closed, no service cancelled, no payment stopped.</p>" +
          '<p class="pack-tally">' +
          tallyHTML(data.counts) +
          "</p>" +
          '<p class="pack-actions"><button class="button" type="button" ' +
          'id="print-pack">Print this pack</button></p>' +
          "</header>" +
          "<h2 class=\"label\">What each institution asked for</h2>" +
          main.map(packEntryHTML).join("") +
          (tail.length
            ? '<section class="standout">' +
              '<p class="standout-flag">' +
              FLAG_ICON +
              "Still with the family</p>" +
              '<div class="pack-section-head">' +
              '<p class="label">' +
              tail.length +
              " of " +
              data.entries.length +
              " institutions</p>" +
              "<h2>Still needs a person</h2>" +
              '<p class="pack-section-note">Nothing was established here. ' +
              "These are not failures to hide at the back of a report; they " +
              "are the calls a member of the family still has to make." +
              "</p></div>" +
              tail.map(packEntryHTML).join("") +
              "</section>"
            : "") +
          '<p class="pack-close">Afterword asked. It did not act. Anything ' +
          "an institution offered stops here, with the family, for a " +
          "decision.</p>" +
          "</article>";

        var button = document.getElementById("print-pack");
        if (button) {
          button.addEventListener("click", function () {
            window.print();
          });
        }
      })
      .catch(function (error) {
        view.innerHTML = errorHTML(error, "The pack");
      });
  }

  /* ---- view 2: calls --------------------------------------------------- */

  function renderCallList() {
    view.innerHTML = '<p class="loading">Loading the institutions.</p>';
    Promise.all([estate(), pack()])
      .then(function (both) {
        var est = both[0];
        var graded = {};
        both[1].entries.forEach(function (entry) {
          graded[entry.institution_id] = entry.grade;
        });
        view.innerHTML =
          '<div class="page-head">' +
          '<p class="label">Six institutions on this estate</p>' +
          "<h1>Calls</h1>" +
          '<p class="lede">One call each. Open one to read what was said, ' +
          "the quoted spans it was graded on, and the transcript. You can " +
          "also re-run a call under any of the scripted scenarios.</p></div>" +
          '<ul class="call-list">' +
          est.institutions
            .map(function (institution) {
              return (
                "<li>" +
                '<a class="call-row" href="#/calls/' +
                esc(institution.institution_id) +
                '">' +
                tileHTML(institution.kind, institution.institution) +
                '<span class="call-row-text"><span class="call-row-name">' +
                esc(institution.institution) +
                '</span><span class="call-row-sub">' +
                esc(kindWord(institution.kind)) +
                " &nbsp; " +
                esc(institution.masked_phone) +
                (institution.prior_calls
                  ? " &nbsp; " +
                    institution.prior_calls +
                    (institution.prior_calls === 1
                      ? " earlier call on file"
                      : " earlier calls on file")
                  : "") +
                (institution.has_recorded_policy
                  ? " &nbsp; policy on file"
                  : " &nbsp; publishes nothing") +
                "</span></span>" +
                (graded[institution.institution_id]
                  ? gradeHTML(graded[institution.institution_id])
                  : '<span class="call-row-sub">Read the call</span>') +
                "</a></li>"
              );
            })
            .join("") +
          "</ul>";
      })
      .catch(function (error) {
        view.innerHTML = errorHTML(error, "The institutions");
      });
  }

  function requirementHTML(requirement) {
    if (!requirement) {
      return (
        '<p class="quiet">No requirement was stated on this call, so ' +
        "nothing was recorded.</p>"
      );
    }
    var rows = [
      ["Department", requirement.department ? esc(requirement.department) : '<span class="quiet">Not named</span>'],
      [
        "Documents needed",
        requirement.documents_needed.length
          ? '<div class="side-answer"><ul>' +
            requirement.documents_needed
              .map(function (doc) {
                return "<li>" + esc(doc) + "</li>";
              })
              .join("") +
            "</ul></div>"
          : '<span class="quiet">None named</span>'
      ],
      [
        "Certified copy",
        esc(
          CERTIFIED_WORDS[requirement.certified_copy_accepted] ||
            requirement.certified_copy_accepted
        )
      ],
      [
        "Direct debits",
        esc(
          DEBIT_WORDS[requirement.direct_debits_action] ||
            requirement.direct_debits_action
        )
      ],
      [
        "Reference opened",
        requirement.reference_opened
          ? "<code>" + esc(requirement.reference_opened) + "</code>"
          : '<span class="quiet">None yet</span>'
      ]
    ];
    return (
      '<dl class="fields">' +
      rows
        .map(function (row) {
          return "<dt>" + esc(row[0]) + "</dt><dd>" + row[1] + "</dd>";
        })
        .join("") +
      "</dl>"
    );
  }

  function transcriptHTML(turns) {
    return (
      '<ul class="transcript">' +
      turns
        .map(function (turn) {
          var minutes = Math.floor(turn.offset_seconds / 60);
          var seconds = Math.floor(turn.offset_seconds % 60);
          var stamp =
            minutes + ":" + (seconds < 10 ? "0" + seconds : String(seconds));
          return (
            '<li class="turn" data-speaker="' +
            esc(turn.speaker) +
            '"><span class="turn-at">' +
            esc(stamp) +
            '</span><span><span class="turn-who">' +
            (turn.speaker === "bot" ? "Afterword" : "The institution") +
            '</span><span class="turn-text">' +
            esc(turn.text) +
            "</span></span></li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function renderCallDetail(institutionId, scenario) {
    view.innerHTML = '<p class="loading">Running the call.</p>';
    Promise.all([capture(institutionId, scenario), estate()])
      .then(function (both) {
        var data = both[0];
        var est = both[1];
        var scenarioKeys = Object.keys(est.scenarios);

        view.innerHTML =
          '<p><a class="back-link" href="#/calls">Back to all calls</a></p>' +
          '<div class="page-head detail-head">' +
          tileHTML(data.kind, data.institution) +
          "<div><h1>" +
          esc(data.institution) +
          "</h1>" +
          '<p class="entry-line"><span>' +
          esc(kindWord(data.kind)) +
          '</span><span class="sep">' +
          esc(data.masked_phone) +
          '</span><span class="sep">' +
          esc(data.institution_id) +
          "</span></p>" +
          gradeHTML(data.grade) +
          "</div></div>" +
          '<div class="section"><span class="label">Why this grade</span>' +
          '<ul class="chips">' +
          data.reasons
            .map(function (reason) {
              return "<li>" + esc(reasonWord(reason)) + "</li>";
            })
            .join("") +
          "</ul></div>" +
          '<div class="section"><span class="label">What they said they ' +
          "require</span>" +
          requirementHTML(data.requirement) +
          (data.conflicts.length
            ? '<div class="aside-note warn"><p>' +
              data.conflicts.length +
              (data.conflicts.length === 1
                ? " answer on this call contradicts"
                : " answers on this call contradict") +
              " something already on file. Both sides are kept. See " +
              '<a href="#/disputes">Disputes</a>.</p></div>'
            : "") +
          "</div>" +
          (data.evidence_quotes.length
            ? '<div class="section"><span class="label">Quoted spans this ' +
              "was graded on</span>" +
              '<ul class="quotes">' +
              data.evidence_quotes
                .map(function (quote) {
                  return "<li>" + esc(quote) + "</li>";
                })
                .join("") +
              "</ul></div>"
            : "") +
          '<div class="section"><span class="label">Transcript</span>' +
          transcriptHTML(data.transcript) +
          "</div>" +
          '<div class="section"><span class="label">Re-run this call under ' +
          "another scenario</span>" +
          '<p class="quiet">Scripted calls only. Nothing here dials ' +
          "anybody.</p>" +
          '<form class="scenario-form" id="scenario-form">' +
          '<label class="label" for="scenario">Scenario</label>' +
          '<select id="scenario" name="scenario">' +
          scenarioKeys
            .map(function (key) {
              return (
                '<option value="' +
                esc(key) +
                '"' +
                (key === data.scenario ? " selected" : "") +
                ">" +
                esc(key.replace(/_/g, " ")) +
                "</option>"
              );
            })
            .join("") +
          "</select>" +
          '<button class="button" type="submit">Run it</button>' +
          "</form>" +
          '<p class="quiet" id="scenario-note">' +
          esc(est.scenarios[data.scenario] || "") +
          "</p></div>";

        var form = document.getElementById("scenario-form");
        var select = document.getElementById("scenario");
        var note = document.getElementById("scenario-note");
        select.addEventListener("change", function () {
          note.textContent = est.scenarios[select.value] || "";
        });
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          var target = "#/calls/" + institutionId + "/" + select.value;
          if (window.location.hash === target) {
            // Same scenario again: no hashchange fires, so render it here
            // rather than leave the button looking broken.
            renderCallDetail(institutionId, select.value);
          } else {
            window.location.hash = target;
          }
        });
      })
      .catch(function (error) {
        view.innerHTML =
          '<p><a class="back-link" href="#/calls">Back to all calls</a></p>' +
          errorHTML(error, "This call");
      });
  }

  /* ---- view 3: disputes ------------------------------------------------ */

  function disputeHTML(entry, conflict) {
    return (
      '<section class="dispute">' +
      "<h3>" +
      esc(FIELD_QUESTIONS[conflict.field] || fieldWord(conflict.field)) +
      "</h3>" +
      '<p class="dispute-where">' +
      esc(entry.institution) +
      " &nbsp; " +
      esc(fieldWord(conflict.field)) +
      "</p>" +
      '<div class="sides">' +
      '<div class="side"><span class="label">' +
      esc(sourceHeading(conflict.stated_source)) +
      '</span><div class="side-answer">' +
      answerHTML(conflict.field, conflict.stated) +
      '</div><p class="side-source">' +
      esc(sourceWord(conflict.stated_source)) +
      "</p></div>" +
      '<div class="side"><span class="label">' +
      esc(sourceHeading(conflict.counter_source)) +
      '</span><div class="side-answer">' +
      answerHTML(conflict.field, conflict.counter) +
      '</div><p class="side-source">' +
      esc(sourceWord(conflict.counter_source)) +
      "</p></div>" +
      "</div>" +
      (conflict.quote
        ? '<div class="section"><span class="label">The span this call was ' +
          "graded on</span>" +
          '<ul class="quotes"><li>' +
          esc(conflict.quote) +
          "</li></ul></div>"
        : "") +
      "</section>"
    );
  }

  function renderDisputes() {
    view.innerHTML = '<p class="loading">Loading the disputes.</p>';
    pack()
      .then(function (data) {
        var rows = [];
        data.entries.forEach(function (entry) {
          entry.conflicts.forEach(function (conflict) {
            rows.push({ entry: entry, conflict: conflict });
          });
        });

        view.innerHTML =
          '<div class="page-head">' +
          '<p class="label">' +
          rows.length +
          (rows.length === 1 ? " contradiction" : " contradictions") +
          " on file</p>" +
          "<h1>Disputes</h1>" +
          '<p class="lede">Two answers to the same question. One of them came ' +
          "from an adviser on the telephone; the other came from the same " +
          "institution earlier, or from what it publishes itself.</p>" +
          "<p><strong>Afterword does not pick a winner.</strong> It has no " +
          "way of knowing which adviser was right, and pretending otherwise " +
          "would be the most expensive thing it could do. Quietly choosing " +
          "the answer that says an original is required is how a family " +
          "posts an original death certificate that then goes missing in " +
          "somebody's internal post. So both answers are kept, with where " +
          "each came from, and the family or the solicitor decides which to " +
          "act on, once, with their eyes open.</p></div>" +
          (rows.length
            ? rows
                .map(function (row) {
                  return disputeHTML(row.entry, row.conflict);
                })
                .join("")
            : '<p class="quiet">No contradictions were found on this ' +
              "estate.</p>");
      })
      .catch(function (error) {
        view.innerHTML = errorHTML(error, "The disputes");
      });
  }

  /* ---- view 4: what it may not do -------------------------------------- */

  /* The forbidden categories are the ones disclosure.py refuses by pattern.
     The API returns the permitted values, not the blacklist, so the names are
     spelled out here and the script below is checked live against them. */
  var FORBIDDEN = [
    ["A cause of death", "How somebody died is never a document requirement."],
    [
      "A date of birth",
      "The phrase is refused outright, so a script cannot invite an adviser " +
        "to have one read back."
    ],
    ["An account balance", "What is in the account is the executor's business."],
    [
      "A telephone number",
      "A number in the script is a number in every preview and every log of it."
    ]
  ];

  var PHONE_PATTERNS = [/\+\d[\d\s-]{6,}\d/, /\b0\d{9,10}\b/];

  /* Which of the three permitted values this is, matched rather than assumed
     from position in the list. */
  function budgetLabel(est, value) {
    if (value === est.deceased_name) {
      return "The name of the person who died";
    }
    if (value === est.executor_name) {
      return "The name of the executor asking";
    }
    if (value === est.reference) {
      return "The reference the family was given";
    }
    return "Permitted by the estate record";
  }

  function budgetValueHTML(est, value) {
    if (value === est.reference) {
      return "<code>" + esc(value) + "</code>";
    }
    return esc(value);
  }

  function longestDigitRun(text) {
    var matches = text.match(/\d(?:[\d\s-]*\d)?/g) || [];
    var longest = 0;
    matches.forEach(function (match) {
      var digits = match.replace(/\D/g, "").length;
      if (digits > longest) {
        longest = digits;
      }
    });
    return longest;
  }

  function verdictHTML(ok, text) {
    return (
      '<p class="verdict' +
      (ok ? "" : " bad") +
      '"><span class="dot" aria-hidden="true"></span><span>' +
      esc(text) +
      "</span></p>"
    );
  }

  function renderBoundary() {
    view.innerHTML = '<p class="loading">Loading the boundary.</p>';
    Promise.all([pack(), estate()])
      .then(function (both) {
        var data = both[0];
        var est = both[1];
        var total = data.entries.length;
        var closes = data.entries.filter(function (entry) {
          return entry.closes_account;
        }).length;
        var accepts = data.entries.filter(function (entry) {
          return entry.accepts_terms;
        }).length;

        var sample = data.entries[0];
        var script = sample ? sample.task_text : "";
        var phoneHit = PHONE_PATTERNS.some(function (pattern) {
          return pattern.test(script);
        });
        var run = longestDigitRun(script);

        view.innerHTML =
          '<div class="page-head">' +
          '<p class="label">The commitment boundary</p>' +
          "<h1>What it may not do</h1>" +
          '<p class="lede">Afterword may ask. It may never do. That is not a ' +
          "tone of voice or a line in a prompt somewhere; it is a set of " +
          "rules in code, and this page reads them back off the same API the " +
          "pack is built from.</p></div>" +
          '<div class="section"><span class="label">Enforced on every one of ' +
          "the " +
          total +
          " calls</span>" +
          '<ul class="facts">' +
          '<li><span class="fact-name">closes_account = false</span>' +
          '<span class="fact-said">' +
          (closes === 0
            ? "All " +
              total +
              " calls report it. The property is hard-wired to false and " +
              "swept by property tests, so no call can close an account, " +
              "cancel a service, move money or redirect post."
            : closes + " calls reported closing an account. That is a bug.") +
          "</span></li>" +
          '<li><span class="fact-name">accepts_terms = false</span>' +
          '<span class="fact-said">' +
          (accepts === 0
            ? "All " +
              total +
              " calls report it. Nothing is agreed, waived or settled on the " +
              "family's behalf. Anything an institution offers stops at the " +
              "family for a decision."
            : accepts + " calls reported accepting terms. That is a bug.") +
          "</span></li>" +
          '<li><span class="fact-name">binding = false</span>' +
          '<span class="fact-said">The default on every capture record, and ' +
          "the one fact on this page the API does not carry: a requirement " +
          "in the pack is what an adviser said, quoted. It does not oblige " +
          "the institution and it does not oblige the family.</span></li>" +
          "</ul></div>" +
          '<div class="section"><span class="label">The disclosure ' +
          "budget</span>" +
          "<p>An institution needs three things: who died, who is asking, and " +
          "the reference the family was given. The estate record holds a good " +
          "deal more than that, and " +
          est.withheld_count +
          " of those values are held back in code rather than by good " +
          "manners.</p>" +
          '<div class="budget">' +
          '<div><span class="label">May be spoken</span><ul class="may">' +
          est.disclosure_budget
            .map(function (value) {
              return (
                "<li>" +
                budgetValueHTML(est, value) +
                '<span class="fact-said">' +
                esc(budgetLabel(est, value)) +
                "</span></li>"
              );
            })
            .join("") +
          "</ul></div>" +
          '<div><span class="label">Never, however phrased</span>' +
          '<ul class="never">' +
          FORBIDDEN.map(function (item) {
            return (
              "<li>" +
              esc(item[0]) +
              '<span class="fact-said">' +
              esc(item[1]) +
              "</span></li>"
            );
          }).join("") +
          "</ul></div></div>" +
          '<p class="quiet">A script that would name any of them cannot be ' +
          "built at all: the check runs where the script is composed, so the " +
          "call is never placed.</p></div>" +
          '<div class="section"><span class="label">The number is not in the ' +
          "script</span>" +
          "<p>The line being dialled travels in the request's " +
          "<code>recipients</code> field, where the telephony provider needs " +
          "it. It is never written into the spoken text, so a plan preview " +
          "can show the whole script to the family without disclosing the " +
          "number. Below is the script actually built for " +
          esc(sample ? sample.institution : "the first institution") +
          ", whose line this console shows only as <code>" +
          esc(sample ? sample.masked_phone : "") +
          "</code>.</p>" +
          verdictHTML(
            !phoneHit,
            phoneHit
              ? "A telephone number pattern matched the script. That is a bug."
              : "Checked in this page: no telephone number pattern matches the script."
          ) +
          verdictHTML(
            run < 6,
            "Longest unbroken run of digits anywhere in the script: " +
              run +
              (run < 6
                ? ". Far too short to be a telephone number. What is left " +
                  "is the family's own reference."
                : ". Long enough to be a telephone number. That is a bug.")
          ) +
          '<div class="overflow-x"><pre class="script-proof">' +
          esc(script) +
          "</pre></div></div>";
      })
      .catch(function (error) {
        view.innerHTML = errorHTML(error, "The commitment boundary");
      });
  }

  /* ---- routing --------------------------------------------------------- */

  function setNav(name) {
    var links = nav.querySelectorAll(".nav-link");
    for (var i = 0; i < links.length; i += 1) {
      if (links[i].getAttribute("data-view") === name) {
        links[i].setAttribute("aria-current", "page");
      } else {
        links[i].removeAttribute("aria-current");
      }
    }
  }

  function route() {
    var hash = window.location.hash.replace(/^#\/?/, "");
    var parts = hash.split("/").filter(Boolean);
    var name = parts[0] || "pack";

    window.scrollTo(0, 0);

    if (name === "calls") {
      setNav("calls");
      if (parts[1]) {
        renderCallDetail(parts[1], parts[2] || null);
      } else {
        renderCallList();
      }
      return;
    }
    if (name === "disputes") {
      setNav("disputes");
      renderDisputes();
      return;
    }
    if (name === "boundary") {
      setNav("boundary");
      renderBoundary();
      return;
    }
    setNav("pack");
    renderPack();
  }

  /* ---- the rail -------------------------------------------------------- */

  /* The rail repeats two facts the pack already carries -- how many
     institutions were called, and how many of those calls left nothing for a
     person to do -- and reads them off the same endpoints the views read.
     If either read fails the views say so loudly; the rail stays quiet. */
  function fillRail() {
    var count = document.getElementById("rail-count");
    var fill = document.getElementById("rail-bar-fill");
    var note = document.getElementById("rail-note");
    var avatar = document.getElementById("avatar");

    pack()
      .then(function (data) {
        var total = data.entries.length;
        var settled = data.entries.filter(function (entry) {
          return !STILL_NEEDS[entry.grade];
        }).length;
        var left = total - settled;
        if (count) {
          count.textContent = String(total);
        }
        if (fill && total) {
          fill.style.width = Math.round((settled / total) * 100) + "%";
        }
        if (note) {
          note.textContent =
            settled +
            " of " +
            total +
            " answered by a person." +
            (left
              ? left === 1
                ? " One still needs somebody to call."
                : " " + left + " still need somebody to call."
              : "");
        }
      })
      .catch(function () {});

    estate()
      .then(function (est) {
        if (avatar) {
          avatar.textContent = initials(est.executor_name);
        }
      })
      .catch(function () {});
  }

  var railPrint = document.getElementById("side-print");
  if (railPrint) {
    railPrint.addEventListener("click", function () {
      window.print();
    });
  }

  window.addEventListener("hashchange", route);
  route();
  fillRail();
})();
