"""The office dashboard.

Loopback-bound, dry run by default, server-rendered with no build step. Its job
is to be calm and to explain its reasoning: the guards, the cascade and every
refusal are on screen, so "why is this case not being called?" never requires
reading a log.

Every blocking transport call is dispatched to a worker thread, because the
CALL-E SDK has no async client and one in-flight call would otherwise stall the
whole dashboard.
"""

from __future__ import annotations

import asyncio
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, Form, Request
from fastapi.responses import (
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
)
from fastapi.templating import Jinja2Templates

from .. import exports, policy
from ..calls.dryrun_client import DryRunClient
from ..config import Config, load_env_file
from ..models import (
    FLAGGED_HEALTH,
    HEALTH_TEXT,
    ContactCheckState,
    ContactHealth,
    Disposition,
    PatternState,
    Workflow,
)
from ..orchestrator import Orchestrator
from ..phone import mask, mask_display
from ..store import Store, from_json

TEMPLATES = Path(__file__).parent / "templates"

#: States a member of staff may move a case into by hand.
RESOLVE_OPTIONS = {
    Workflow.CONTACT_CHECK: [
        ContactCheckState.CC_VERIFIED.value,
        ContactCheckState.CC_WRONG_PERSON.value,
        ContactCheckState.CC_NUMBER_NOT_WORKING.value,
        ContactCheckState.CC_UNREACHED.value,
        ContactCheckState.CC_NOT_CALLED.value,
    ],
    Workflow.PATTERN_FOLLOWUP: [
        PatternState.PF_REASON_GIVEN.value,
        PatternState.PF_SUPPORT_REQUESTED.value,
        PatternState.PF_UNREACHED.value,
        PatternState.PF_NOT_CALLED.value,
    ],
}

#: Plain-English versions of the vocabulary, for the demo view only. The
#: dashboard deliberately shows the real state names, because an office needs to
#: be able to match what it sees against the documentation; the demo view is for
#: somebody seeing the app for the first time.
OUTCOME_TEXT = {
    "reached": "Reachable spoke to them",
    "wrong_person": "Wrong person",
    "voicemail": "Went to voicemail",
    "no_answer": "Nobody answered",
    "not_in_service": "Number not in service",
}

STATE_TEXT = {
    ContactCheckState.CC_VERIFIED.value: "Contact verified",
    ContactCheckState.CC_WRONG_PERSON.value: "Flagged: wrong person",
    ContactCheckState.CC_NUMBER_NOT_WORKING.value: "Flagged: number not working",
    ContactCheckState.CC_UNREACHED.value: "Not reached",
    ContactCheckState.CC_NEEDS_HUMAN.value: "Sent to a person",
    PatternState.PF_REASON_GIVEN.value: "Reason suggested, awaiting approval",
    PatternState.PF_SUPPORT_REQUESTED.value: "Support requested",
    PatternState.PF_URGENT_HUMAN.value: "Escalated to a person, urgently",
    PatternState.PF_CASCADE_READY.value: "Moving to the next contact",
    PatternState.PF_UNREACHED.value: "Nobody reached",
    PatternState.PF_NEEDS_HUMAN.value: "Sent to a person",
}

#: Refusals, in words an onlooker can follow. A refusal is a feature here, so it
#: should read like one rather than like an error.
REFUSAL_TEXT = {
    "dry_run": "Dry run: nothing is dialled until live mode is switched on.",
    "awaiting_confirmation": "This call still needs to be confirmed.",
    "outside_calling_window": "It is outside the school's calling window.",
    "non_school_day": "Today is not a school day.",
    "pupil_vulnerable": "This pupil is flagged vulnerable, so Reachable never calls.",
    "language_not_supported": "This contact needs a language the UK line cannot serve.",
    "do_not_call": "This contact has asked not to be called.",
    "invalid_number": "This number is not valid, and is never repaired or guessed.",
    "attempt_budget_spent": "The attempt budget for this household is spent.",
    "call_in_progress": "A call for this case is already in flight.",
    "cascade_limit_reached": "Every contact in the cascade has been tried.",
}


#: How many cards the demo view shows at once.
DEMO_CARD_LIMIT = 6


def _diallable(case: Any, workflow: Workflow) -> bool:
    """Whether this case is in a state a call may be placed from."""
    if workflow is Workflow.CONTACT_CHECK:
        return ContactCheckState(case["state"]) in {
            ContactCheckState.CC_PENDING,
            ContactCheckState.CC_READY,
        }
    return PatternState(case["state"]) is PatternState.PF_CASCADE_READY


TONE = {
    ContactHealth.VERIFIED: "ok",
    ContactHealth.NOT_CHECKED: "",
    ContactHealth.UPDATE_REQUESTED: "wait",
    ContactHealth.UNREACHED: "wait",
}


def _tone(status: str) -> str:
    try:
        health = ContactHealth(status)
    except ValueError:
        return ""
    if health in FLAGGED_HEALTH:
        return "stop"
    return TONE.get(health, "")


def build_orchestrator(config: Config) -> Orchestrator:
    """Choose a transport from configuration. Dry run is the default."""
    if not config.live_calls:
        client: Any = DryRunClient()
    elif config.uses_fake_calle:
        from fake_calle.server import FakeCalleClient

        client = FakeCalleClient()
    else:
        from ..calls.calle_client import CalleClient

        client = CalleClient(config)
    return Orchestrator(store=Store.open(config.db_path), config=config, client=client)


def create_app(
    config: Config | None = None, *, orchestrator: Orchestrator | None = None
) -> FastAPI:
    """Build the app.

    ``Config.from_env()`` enforces the credential origin allowlist, so a
    misconfigured base URL raises here rather than when somebody tries to call.
    """
    if config is None:
        load_env_file()
    config = config or Config.from_env()
    app = FastAPI(title="Reachable", docs_url=None, redoc_url=None)
    templates = Jinja2Templates(directory=str(TEMPLATES))
    templates.env.filters["mask"] = mask
    # Mask only evaluated display values; template control flow and the
    # orchestrator's evidence/identity comparisons keep their original inputs.
    templates.env.finalize = mask_display

    orc = orchestrator or build_orchestrator(config)
    if orchestrator is None:
        orc.import_data()
        # Retention runs at startup. A policy that only runs when a scheduler
        # happens to fire is a policy that does not run.
        orc.purge_expired_transcripts()
        # And anything left in flight by a previous process is reconciled by
        # reading it back, never by dialling again.
        orc.resume()
    app.state.orchestrator = orc
    app.state.report = None

    def ctx(request: Request, **extra: Any) -> dict[str, Any]:
        return {
            "request": request,
            "mode": orc.config.mode_banner,
            "school_name": orc.config.school_name,
            "names": {p.pupil_id: p.first_name for p in orc.dataset.pupils.values()},
            **extra,
        }

    def render(request: Request, name: str, **extra: Any) -> HTMLResponse:
        return templates.TemplateResponse(request, name, ctx(request, **extra))

    def csv_response(body: str, filename: str) -> PlainTextResponse:
        return PlainTextResponse(
            body,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # ------------------------------------------------------------------ views

    @app.get("/", response_class=HTMLResponse)
    def today(request: Request):
        cases = orc.store.cases(Workflow.PATTERN_FOLLOWUP)
        urgent = [c for c in cases if c["state"] == PatternState.PF_URGENT_HUMAN.value]
        grouped: dict[str, list] = {}
        for case in cases:
            grouped.setdefault(case["state"], []).append(case)
        # Urgent first, then everything else, so the eye lands in the right place.
        ordered = dict(
            sorted(
                grouped.items(),
                key=lambda item: (item[0] != PatternState.PF_URGENT_HUMAN.value, item[0]),
            )
        )
        return render(
            request,
            "today.html",
            counters=exports.counters(orc.store, orc.dataset),
            urgent_cases=urgent,
            grouped=ordered,
            detail=lambda case: from_json(case["detail"], {}) or {},
            today=date.today().isoformat(),
        )

    @app.get("/contacts", response_class=HTMLResponse)
    def contacts(request: Request):
        health = {row["contact_id"]: row for row in orc.store.contact_health()}
        rows = []
        for contact in sorted(
            orc.dataset.contacts, key=lambda c: (c.pupil_id, c.contact_order)
        ):
            entry = health.get(contact.contact_id)
            status = entry["status"] if entry else ContactHealth.NOT_CHECKED.value
            pupil = orc.dataset.pupils.get(contact.pupil_id)
            rows.append(
                type(
                    "Row",
                    (),
                    {
                        "pupil_first_name": pupil.first_name if pupil else contact.pupil_id,
                        "contact_order": contact.contact_order,
                        "contact_name": contact.contact_name,
                        "masked": mask(contact.phone_e164),
                        "status_text": HEALTH_TEXT.get(ContactHealth(status), status),
                        "tone": _tone(status),
                        "reason": entry["reason"] if entry else "",
                        "last_checked": entry["last_checked"] if entry else "",
                        "source": entry["source"] if entry else "",
                    },
                )(),
            )
        return render(
            request,
            "contacts.html",
            contacts=rows,
            reachability=exports.reachability(orc.store, orc.dataset),
        )

    @app.get("/cases/{case_id}", response_class=HTMLResponse)
    def case_detail(request: Request, case_id: str):
        case = orc.store.case(case_id)
        if case is None:
            return RedirectResponse("/", status_code=303)
        workflow = Workflow(case["workflow"])
        pupil = orc.dataset.pupils.get(case["pupil_id"])
        health = {row["contact_id"]: row for row in orc.store.contact_health()}

        cascade = []
        for index, contact in enumerate(
            policy.callable_contacts(orc.dataset, case["pupil_id"])
        ):
            entry = health.get(contact.contact_id)
            status = entry["status"] if entry else ContactHealth.NOT_CHECKED.value
            cascade.append(
                type(
                    "Row",
                    (),
                    {
                        "contact_order": contact.contact_order,
                        "contact_name": contact.contact_name,
                        "masked": mask(contact.phone_e164),
                        "status_text": HEALTH_TEXT.get(ContactHealth(status), status),
                        "tone": _tone(status),
                        "current": contact.contact_id == case["contact_id"],
                        "attempts": orc.store.attempts_for_contact(
                            case_id, contact.contact_id
                        ),
                    },
                )(),
            )

        diallable = (
            ContactCheckState(case["state"])
            in {ContactCheckState.CC_PENDING, ContactCheckState.CC_READY}
            if workflow is Workflow.CONTACT_CHECK
            else PatternState(case["state"]) is PatternState.PF_CASCADE_READY
        )

        preview = None
        guards: list = []
        if case["contact_id"]:
            contact = orc._contact(case["contact_id"])
            if contact is not None and pupil is not None:
                guards = policy.describe_guards(
                    config=orc.config,
                    store=orc.store,
                    dataset=orc.dataset,
                    pupil=pupil,
                    contact=contact,
                    case_id=case_id,
                    confirmed=False,
                    now=orc.clock(),
                )
                if diallable:
                    try:
                        preview = orc.preview(case_id)
                    except Exception:  # noqa: BLE001 - a render failure is shown, not raised
                        preview = None

        attempts = orc.store.rows(
            "SELECT * FROM call_attempts WHERE case_id = ? ORDER BY id", (case_id,)
        )
        last = next(
            (a for a in reversed(attempts) if a["structured_result"]), None
        )
        result = from_json(last["structured_result"], {}) if last else {}
        quotes = [q for q in (result.get("verbatim_quotes") or []) if q]
        if result.get("verbatim_identity_quote"):
            quotes = [result["verbatim_identity_quote"]]

        approved = orc.store.one(
            "SELECT 1 FROM events WHERE case_id = ? AND kind = 'staff.approved_reason'",
            (case_id,),
        )
        category = result.get("reason_category")
        return render(
            request,
            "case.html",
            case=case,
            pupil=pupil,
            detail=from_json(case["detail"], {}) or {},
            cascade=cascade,
            guards=guards,
            preview=preview,
            can_call=preview is not None,
            attempts=attempts,
            quotes=quotes,
            suggested_reason=category if category and category != "unknown" else "",
            reason_note=result.get("reason_note", ""),
            reason_approved=bool(approved),
            events=orc.store.events_for(case_id),
            resolve_options=RESOLVE_OPTIONS[workflow],
        )

    @app.get("/tasks", response_class=HTMLResponse)
    def tasks(request: Request):
        rows = orc.store.tasks()
        return render(
            request,
            "tasks.html",
            urgent=[t for t in rows if t["urgent"]],
            ordinary=[t for t in rows if not t["urgent"]],
        )

    @app.get("/decisions", response_class=HTMLResponse)
    def decisions(request: Request):
        return render(request, "decisions.html", decisions=orc.store.decisions())

    @app.get("/import", response_class=HTMLResponse)
    def import_view(request: Request):
        return render(
            request, "import.html", report=app.state.report, data_dir=orc.config.data_dir
        )

    # ---------------------------------------------------------------- actions

    @app.post("/import")
    async def do_import(request: Request):
        app.state.report = await asyncio.to_thread(orc.import_data)
        return RedirectResponse("/import", status_code=303)

    @app.post("/scan")
    async def do_scan(request: Request):
        await asyncio.to_thread(orc.scan_register)
        return RedirectResponse("/", status_code=303)

    @app.post("/contact-check")
    async def do_contact_check(request: Request):
        await asyncio.to_thread(orc.start_contact_check)
        return RedirectResponse("/contacts", status_code=303)

    @app.post("/cases/{case_id}/call")
    async def do_call(case_id: str, confirm: str = Form(default="")):
        """The per-call confirmation. Typing the pupil's first name is the gate."""
        case = orc.store.case(case_id)
        pupil = orc.dataset.pupils.get(case["pupil_id"]) if case else None
        confirmed = bool(
            pupil and confirm.strip().casefold() == pupil.first_name.casefold()
        )
        outcome = await asyncio.to_thread(
            orc.place_call, case_id, confirmed=confirmed, actor="dashboard"
        )
        if outcome.placed and outcome.attempt_id:
            await asyncio.to_thread(orc.reconcile, outcome.attempt_id)
        return RedirectResponse(f"/cases/{case_id}", status_code=303)

    @app.post("/cases/{case_id}/approve-reason")
    async def do_approve(case_id: str):
        await asyncio.to_thread(orc.approve_suggested_reason, case_id, actor="dashboard")
        return RedirectResponse(f"/cases/{case_id}", status_code=303)

    @app.post("/cases/{case_id}/resolve")
    async def do_resolve(case_id: str, target: str = Form(...), note: str = Form(default="")):
        await asyncio.to_thread(
            orc.staff_resolve, case_id, target, actor="dashboard", note=note
        )
        return RedirectResponse(f"/cases/{case_id}", status_code=303)

    @app.post("/tasks/{task_id}/handled")
    async def do_handled(task_id: str):
        await asyncio.to_thread(orc.mark_task_handled, task_id, actor="dashboard")
        return RedirectResponse("/tasks", status_code=303)

    # ---------------------------------------------------------------- exports

    @app.post("/export/contact-changes")
    def export_changes():
        return csv_response(
            exports.suggested_contact_changes(orc.store, orc.dataset),
            "suggested-contact-changes.csv",
        )

    @app.post("/export/register-reasons")
    def export_reasons():
        return csv_response(
            exports.suggested_register_reasons(orc.store, orc.dataset),
            "suggested-register-reasons.csv",
        )

    @app.post("/export/contact-health")
    def export_health():
        return csv_response(
            exports.contact_health_report(orc.store, orc.dataset),
            "contact-health-report.csv",
        )

    # -------------------------------------------------------------- demo view
    #
    # A single, calmer surface for showing the app to somebody. It places the
    # same call through the same orchestrator and the same guards as the
    # dashboard -- there is no separate path to the telephone -- but it does not
    # block on the result. A real call sat in `queued` for about a minute during
    # live verification, so this starts the call, returns, and lets the page
    # poll until the transcript exists.

    def _demo_people() -> list[dict[str, Any]]:
        """Every case that could be dialled right now, as a friendly card."""
        people: list[dict[str, Any]] = []
        for workflow in (Workflow.PATTERN_FOLLOWUP, Workflow.CONTACT_CHECK):
            for case in orc.store.cases(workflow):
                if not _diallable(case, workflow) or not case["contact_id"]:
                    continue
                contact = orc._contact(case["contact_id"])
                pupil = orc.dataset.pupils.get(case["pupil_id"])
                if contact is None or pupil is None:
                    continue
                pattern = workflow is Workflow.PATTERN_FOLLOWUP
                people.append(
                    {
                        "case_id": case["case_id"],
                        "contact_name": contact.contact_name,
                        "first_name": contact.contact_name.split()[0],
                        "initials": "".join(
                            part[0] for part in contact.contact_name.split()[:2]
                        ).upper(),
                        "relationship": contact.relationship,
                        "contact_order": contact.contact_order,
                        "masked": mask(contact.phone_e164),
                        "pupil_first_name": pupil.first_name,
                        "kind": "Absence follow-up" if pattern else "Contact check",
                        "tone": "warm" if pattern else "",
                        "why": (
                            f"{pupil.first_name} has two sessions with no reason given."
                            if pattern
                            else f"Checking this number still reaches "
                            f"{contact.contact_name.split()[0]}."
                        ),
                    }
                )
        # Absence follow-ups are already first, because the workflows are
        # iterated in that order, and they are the story worth telling first.
        # Capped: a termly sweep opens a case per contact, and twenty-one cards
        # is a list to scroll rather than a thing to look at.
        return people[:DEMO_CARD_LIMIT]

    @app.get("/demo", response_class=HTMLResponse)
    def demo(request: Request):
        return render(
            request,
            "demo.html",
            people=_demo_people(),
            mode_class=orc.config.mode_banner.split("-")[0].lower(),
        )

    @app.post("/demo/call")
    async def demo_call(payload: dict = Body(default={})):
        """Start the call and return immediately. The page polls for the rest."""
        case_id = str(payload.get("case_id", ""))
        case = orc.store.case(case_id)
        if case is None:
            return JSONResponse({"placed": False, "reason": "Unknown case."})
        pupil = orc.dataset.pupils.get(case["pupil_id"])
        confirmed = bool(
            pupil
            and str(payload.get("confirm", "")).strip().casefold()
            == pupil.first_name.casefold()
        )
        if not confirmed:
            return JSONResponse(
                {
                    "placed": False,
                    "reason": (
                        f"That did not match. Type {pupil.first_name} exactly to confirm."
                        if pupil
                        else "This case has no pupil to confirm against."
                    ),
                }
            )
        outcome = await asyncio.to_thread(
            orc.place_call, case_id, confirmed=True, actor="demo"
        )
        if not outcome.placed:
            reason = outcome.reason.value if outcome.reason else "refused"
            # The plain-English sentence first, then whatever detail the guard
            # added -- the time of day, the language, the spreadsheet row.
            words = REFUSAL_TEXT.get(reason.lower(), reason.lower().replace("_", " "))
            if outcome.detail:
                words = f"{words} ({outcome.detail})"
            return JSONResponse({"placed": False, "reason": mask_display(words)})
        return JSONResponse({"placed": True, "attempt_id": outcome.attempt_id})

    @app.get("/demo/attempt/{attempt_id}")
    async def demo_attempt(attempt_id: int):
        """Read the call back and describe it in plain words."""
        await asyncio.to_thread(orc.reconcile, attempt_id)
        row = orc.store.attempt(attempt_id)
        if row is None:
            return JSONResponse({"finished": True, "good": False,
                                 "headline": "Call not found", "status_text": "",
                                 "turns": [], "facts": []})

        turns = mask_display(from_json(row["transcript"], []) or [])
        disposition = row["disposition"]
        case = orc.store.case(row["case_id"])
        state = case["state"] if case else ""

        # Still ringing: no disposition yet, or the provider says not ready.
        if not disposition or disposition == Disposition.OUTCOME_UNKNOWN.value:
            return JSONResponse(
                {
                    "finished": False,
                    "status_text": "Ringing. The transcript appears here as soon as the call ends.",
                    "turns": turns,
                    "facts": [],
                }
            )

        result = from_json(row["structured_result"], {}) or {}
        good = disposition == Disposition.CONFIRMED.value and result.get(
            "outcome"
        ) == "reached"

        facts: list[dict[str, str]] = []
        if result.get("identity_confirmed") == "yes":
            facts.append({"text": "Identity confirmed", "tone": "good"})
        elif result.get("outcome") == "wrong_person":
            facts.append({"text": "Not the right person", "tone": "stop"})
        if result.get("still_willing_to_be_contact") == "yes":
            facts.append({"text": "Still happy to be a contact", "tone": "good"})
        if result.get("best_number_for_school") == "this_number":
            facts.append({"text": "Number is correct", "tone": "good"})
        if result.get("reason_category") and result["reason_category"] != "unknown":
            facts.append({"text": result["reason_category"].replace("_", " "), "tone": "warm"})
        if result.get("barrier_mentioned") == "yes":
            facts.append({"text": "Mentioned a barrier", "tone": "warm"})
        facts.append({"text": STATE_TEXT.get(state, state), "tone": ""})

        return JSONResponse(
            {
                "finished": True,
                "good": good,
                "headline": OUTCOME_TEXT.get(
                    str(result.get("outcome", "")), "Call finished"
                ),
                "status_text": mask_display(row["disposition_reason"] or ""),
                "turns": turns,
                "facts": mask_display(facts),
            }
        )

    @app.get("/healthz")
    def healthz():
        return {"ok": True, "mode": orc.config.mode_banner}

    return app
