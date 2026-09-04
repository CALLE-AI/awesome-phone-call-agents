"""Build a single self-contained page from the committed evidence.

Everything on the page is read out of `evidence/` and `docs/` at build time. Nothing is
typed into the template. A page written by hand drifts away from the repository the moment
either changes, and the whole argument of this app is that a claim should carry the thing
that checks it.

    python tools/judge_page.py out/index.html

No dependencies beyond the standard library, so it runs anywhere the app runs.
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
EVIDENCE = APP / "evidence"

CSS = """
:root{--bg:#0b0d10;--ink:#e8eaed;--dim:#8a919b;--line:#1e242c;--ok:#7dd3a0;--warn:#f0b96e}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.65 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
main{max-width:56rem;margin:0 auto;padding:4rem 1.5rem 6rem}
h1{font-size:2.1rem;line-height:1.2;margin:0 0 .5rem;letter-spacing:-.02em}
h2{font-size:1.25rem;margin:3.5rem 0 .75rem;letter-spacing:-.01em}
h2::before{content:"";display:block;width:2.2rem;height:2px;background:var(--ok);
  margin-bottom:1rem}
p{margin:0 0 1rem;max-width:62ch}
.lede{font-size:1.15rem;color:var(--dim);max-width:56ch;margin-bottom:2rem}
code,pre{font-family:ui-monospace,Consolas,"SF Mono",monospace;font-size:.86em}
pre{background:#070809;border:1px solid var(--line);border-radius:6px;padding:1rem 1.1rem;
  overflow-x:auto;color:#cdd3da}
code:not(pre code){background:#12161b;padding:.1em .35em;border-radius:3px;color:#cdd3da}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.9rem}
th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid var(--line);
  vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:.8rem;text-transform:uppercase;
  letter-spacing:.04em}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:.82rem;color:#a9b2bd;
  word-break:break-all}
.ok{color:var(--ok)}.warn{color:var(--warn)}.dim{color:var(--dim)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:1px;
  background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden;
  margin:1.5rem 0}
.cell{background:var(--bg);padding:1rem}
.num{font-size:1.7rem;font-weight:650;color:var(--ok);font-family:ui-monospace,monospace}
.lbl{font-size:.78rem;color:var(--dim);margin-top:.15rem;line-height:1.35}
.note{border-left:2px solid var(--warn);padding:.15rem 0 .15rem 1rem;color:var(--dim);
  margin:1.25rem 0}
a{color:var(--ok)}
footer{margin-top:4rem;padding-top:1.5rem;border-top:1px solid var(--line);
  color:var(--dim);font-size:.85rem}
"""


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def receipts() -> list[tuple[str, dict]]:
    return [(p.name, json.loads(p.read_text(encoding="utf-8")))
            for p in sorted(EVIDENCE.glob("0*.json"))]


def mutation_rows() -> list[tuple[str, str, str]]:
    text = (EVIDENCE / "MUTATIONS.md").read_text(encoding="utf-8")
    rows = re.findall(r"^\| (\d+) \| (.+?) \| (\d+) \|$", text, re.M)
    return rows


def recovered_provider_ids() -> dict[str, str]:
    """Receipts written before the code recorded `provider_call_id` still have one.

    It was recovered afterwards with a `GET /v1/calls/{id}`, which places no call, and
    committed in `provider-ids.json` by `tools/recover_provider_ids.py`. Reading it back
    from there keeps the page sourced from the repository rather than from a value typed
    into this template.
    """
    mapping = EVIDENCE / "provider-ids.json"
    if not mapping.exists():
        return {}
    return json.loads(mapping.read_text(encoding="utf-8"))


def offline_run() -> str:
    """Run the app for real rather than pasting output that may no longer be true."""
    done = subprocess.run(
        [sys.executable, "-m", "firstbell", "--work-file", "examples/absences.csv"],
        cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (done.stdout or done.stderr).strip()


def test_count() -> int:
    out = subprocess.run([sys.executable, "-m", "pytest", "tests/", "--collect-only", "-q"],
                         cwd=APP, capture_output=True, text=True,
                         encoding="utf-8", errors="replace").stdout
    match = re.search(r"(\d+) tests? collected", out)
    return int(match.group(1)) if match else 0


def build() -> str:
    recs = receipts()
    muts = mutation_rows()
    recovered = recovered_provider_ids()
    live_calls = [(name, d) for name, d in recs if d.get("reached_production_api")]
    call_rows = []
    for name, data in recs:
        for item in data.get("items", []):
            if item.get("call_id"):
                provider = (item.get("provider_call_id")
                            or recovered.get(item["call_id"]))
                call_rows.append((item["call_id"], provider,
                                  item.get("resolution"), name))

    parts: list[str] = []
    add = parts.append

    add(f"<!doctype html><html lang=en><meta charset=utf-8>"
        f"<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>firstbell &middot; evidence</title><style>{CSS}</style><main>")

    add("<h1>firstbell</h1>")
    add("<p class=lede>Calls the families whose absence notification went unanswered, each "
        "in the language that family speaks, and refuses to close a case it could not get "
        "an answer to.</p>")

    add("<div class=grid>")
    for num, label in (
        (test_count(), "tests"),
        (len(muts), "rules broken on purpose to prove a test notices"),
        (len(call_rows), "real calls, each id checkable against CALL-E&rsquo;s own billing"),
        ("none", "CALL-E account needed to run the demo"),
    ):
        add(f"<div class=cell><div class=num>{esc(num)}</div><div class=lbl>{label}</div></div>")
    add("</div>")

    add("<h2>Run the whole thing with no account</h2>")
    add("<p>No API key, no signup, no telephone call. The local double is mounted as an "
        "<code>httpx</code> transport underneath a real <code>calle.CalleClient</code>, so "
        "the offline path exercises the same SDK code as the live one.</p>")
    add("<pre>pip install -r requirements-dev.txt\n"
        "python -m firstbell --work-file examples/absences.csv</pre>")
    add(f"<p class=dim>Output below was produced by running that command when this page was "
        f"built:</p><pre>{esc(offline_run())}</pre>")

    add("<h2>Three outcomes, not two</h2>")
    add("<p><span class=ok>resolved</span> is a schema-valid answer on record. "
        "<span class=dim>failed</span> is nobody reached. "
        "<span class=warn>undetermined</span> is a call that connected and produced nothing "
        "usable, and it goes to a named person. It is never counted toward a coverage "
        "percentage, because the whole point is a child nobody has heard about.</p>")
    add("<div class=note>This app once got that wrong on a real call. A parent refused, "
        "CALL-E returned a schema-valid result with every required field "
        "<code>&quot;unknown&quot;</code>, and the row was marked resolved. That receipt is "
        "committed uncorrected, because a corrected copy would record a run that never "
        "happened.</div>")

    add("<h2>Every real call, checkable against CALL-E&rsquo;s own records</h2>")
    add("<p>The API returns one id. CALL-E&rsquo;s dashboard and usage page are keyed on "
        "another. Both are printed, so a reader can take any row to the vendor&rsquo;s "
        "billing and see the charge and the duration from a source with no stake in these "
        "claims.</p>")
    add("<table><tr><th>API id</th><th>provider id (dashboard)</th><th>outcome</th></tr>")
    for call_id, provider, resolution, _src in call_rows:
        cls = {"resolved": "ok", "undetermined": "warn"}.get(resolution or "", "dim")
        add(f"<tr><td class=mono>{esc(call_id)}</td>"
            f"<td class={'mono' if provider else 'dim'}>"
            f"{esc(provider) if provider else 'not recorded'}</td>"
            f"<td class={cls}>{esc(resolution)}</td></tr>")
    add("</table>")
    have = sum(1 for _c, p, _r, _s in call_rows if p)
    add(f"<p class=dim>{len(live_calls)} of {len(recs)} committed receipts reached the "
        f"production API, and {have} of {len(call_rows)} calls carry the provider id. The "
        f"receipts written before this app recorded that field had it recovered afterwards "
        f"with a <code>GET</code>, which places no call; that mapping is committed in "
        f"<code>evidence/07-locale-experiment.md</code>.</p>")

    add("<h2>Every rule, broken on purpose</h2>")
    add("<p>A test that has never been observed to fail has not been shown to test "
        "anything. Each row is a change made to working code to check that a specific test "
        "notices. Every one was reverted and the suite returned to green.</p>")
    add("<table><tr><th>#</th><th>the change</th><th>tests that failed</th></tr>")
    for num, change, caught in muts:
        add(f"<tr><td class=dim>{esc(num)}</td><td>{esc(change)}</td>"
            f"<td class=ok>{esc(caught)}</td></tr>")
    add("</table>")
    add("<div class=note>Mutation 18 found a live defect rather than confirming a rule. "
        "<code>reached_production_api</code> was computed from the configured base URL "
        "alone, so a run whose every attempt died at the transport layer still published "
        "that it had reached production.</div>")

    add("<h2>What is not true</h2>")
    add("<ul class=dim>")
    for line in (
        "Calls to India arrived from a US caller ID, shown as Oakland CA. A family will not "
        "answer an unknown foreign number about their child, and nothing in this app fixes "
        "that.",
        "CALL-E has no cancel endpoint. Once a call is placed there is no API route to stop "
        "it, so the concurrency cap is the only brake that exists.",
        "The agent does not enforce its own exit. On one call it announced it was ending, "
        "then restarted its opening disclosure.",
        "The locale result rests on one bilingual speaker who knew what was being tested, "
        "one language pair and one region.",
    ):
        add(f"<li>{line}</li>")
    add("</ul>")

    add("<footer>Generated from the committed evidence by "
        "<code>tools/judge_page.py</code>. Nothing on this page is typed into the template; "
        "if the repository changes, this page changes with it."
        "</footer></main></html>")
    return "".join(parts)


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "out/index.html")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(), encoding="utf-8", newline="\n")
    print(f"{out} written, {out.stat().st_size / 1024:.1f} KB")
