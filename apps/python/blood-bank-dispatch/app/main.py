import os
import re
import time
import uuid as uuidmod
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Form, HTTPException, Request  # noqa: E402
from fastapi.responses import RedirectResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.templating import Jinja2Templates  # noqa: E402

from . import db  # noqa: E402
from .auth import (  # noqa: E402
    SESSION_COOKIE,
    allowed_destinations,
    check_password,
    is_authed,
    make_token,
    password_is_set,
)
from .dispatch import CallTarget, DRY_RUN, spawn  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
templates = Jinja2Templates(directory=str(BASE / "app" / "templates"))

E164 = re.compile(r"^\+[1-9]\d{7,14}$")
GROUPS = ("A", "B", "AB", "O")
RHESUS = ("positive", "negative")
MAX_TARGETS = int(os.environ.get("MAX_TARGETS", "8"))
RATE_LIMIT = int(os.environ.get("RATE_LIMIT_RUNS", "6"))
RATE_WINDOW = 600.0  # seconds

_rate: dict[str, deque[float]] = defaultdict(deque)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init()
    yield
    await db.close()


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE / "app" / "static")), name="static")


def render(request: Request, name: str, status_code: int = 200, **ctx):
    ctx["authed"] = password_is_set() and is_authed(request)
    return templates.TemplateResponse(
        request=request, name=name, context=ctx, status_code=status_code
    )


def mask_phone(value) -> str:
    # Contribution-repo convention: keep the first two characters and the
    # last four digits, e.g. +1******2671. Full numbers stay in the database
    # and in the runtime call prompt; they must not appear in rendered views.
    if not value:
        return "—"
    v = str(value)
    if len(v) <= 6:
        return v[0] + "*****"
    return f"{v[:2]}{'*' * (len(v) - 6)}{v[-4:]}"


templates.env.filters["mask"] = mask_phone


def gate(request: Request):
    """Return a Response to short-circuit with, or None to proceed.

    Fail-safe: with APP_PASSWORD unset, mutating and result-viewing routes
    refuse to run at all rather than standing open.
    """
    if not password_is_set():
        return render(request, "disabled.html", status_code=503)
    if not is_authed(request):
        return RedirectResponse("/login", status_code=303)
    return None


@app.get("/login")
async def login_page(request: Request):
    if not password_is_set():
        return render(request, "disabled.html", status_code=503)
    return render(request, "login.html", error=None)


@app.post("/login")
async def login(request: Request, password: str = Form("")):
    if not password_is_set():
        return render(request, "disabled.html", status_code=503)
    if not check_password(password):
        return render(request, "login.html", status_code=401, error="Incorrect password")
    resp = RedirectResponse("/request", status_code=303)
    resp.set_cookie(
        SESSION_COOKIE, make_token(), httponly=True, samesite="lax", max_age=43200
    )
    return resp


@app.post("/logout")
async def logout():
    resp = RedirectResponse("/login", status_code=303)
    resp.delete_cookie(SESSION_COOKIE)
    return resp


@app.get("/")
async def index():
    return RedirectResponse("/request", status_code=303)


# ---------------------------------------------------------------- registry


@app.get("/banks")
async def banks_page(request: Request):
    blocked = gate(request)
    if blocked:
        return blocked
    banks = await db.fetch("select * from banks order by created_at desc")
    return render(request, "registry.html", banks=banks)


def _clean_phone(phone: str) -> str:
    phone = phone.strip()
    if not E164.match(phone):
        raise HTTPException(400, "phone must be E.164, e.g. +15550101234")
    return phone


@app.post("/banks")
async def banks_create(
    request: Request,
    name: str = Form(...),
    phone: str = Form(...),
    area: str = Form(""),
    notes: str = Form(""),
):
    blocked = gate(request)
    if blocked:
        return blocked
    name = name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    await db.execute(
        "insert into banks (name, phone, area, notes) values ($1, $2, $3, $4)"
        " on conflict (phone) do update set name = excluded.name,"
        " area = excluded.area, notes = excluded.notes",
        name,
        _clean_phone(phone),
        area.strip() or None,
        notes.strip() or None,
    )
    return RedirectResponse("/banks", status_code=303)


@app.post("/banks/{bank_id}")
async def banks_update(
    request: Request,
    bank_id: uuidmod.UUID,
    name: str = Form(...),
    new_phone: str = Form(""),
    area: str = Form(""),
    notes: str = Form(""),
    active: str = Form(""),
):
    blocked = gate(request)
    if blocked:
        return blocked
    name = name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    # The phone is never rendered back into the form; a blank new_phone keeps
    # the stored number unchanged.
    row = await db.fetchrow("select phone from banks where id = $1", bank_id)
    if row is None:
        raise HTTPException(404, "bank not found")
    phone = _clean_phone(new_phone) if new_phone.strip() else row["phone"]
    await db.execute(
        "update banks set name = $2, phone = $3, area = $4, notes = $5,"
        " active = $6 where id = $1",
        bank_id,
        name,
        phone,
        area.strip() or None,
        notes.strip() or None,
        active == "on",
    )
    return RedirectResponse("/banks", status_code=303)


@app.post("/banks/{bank_id}/toggle")
async def banks_toggle(request: Request, bank_id: uuidmod.UUID):
    blocked = gate(request)
    if blocked:
        return blocked
    await db.execute("update banks set active = not active where id = $1", bank_id)
    return RedirectResponse("/banks", status_code=303)


# ------------------------------------------------------------------ runs


@app.get("/request")
async def request_page(request: Request):
    blocked = gate(request)
    if blocked:
        return blocked
    banks = await db.fetch("select * from banks where active order by name")
    return render(request, "request.html", banks=banks, error=None, form={})


@app.post("/runs")
async def create_run(
    request: Request,
    blood_group: str = Form(...),
    rhesus: str = Form(...),
    units_needed: int = Form(...),
    requester: str = Form(""),
    bank_ids: list[str] = Form(default=[]),
    adhoc_phone: str = Form(""),
    adhoc_label: str = Form(""),
    adhoc_save: str = Form(""),
):
    blocked = gate(request)
    if blocked:
        return blocked
    client_ip = request.client.host if request.client else "?"
    now = time.monotonic()
    window = _rate[client_ip]
    while window and now - window[0] > RATE_WINDOW:
        window.popleft()
    window.append(now)
    if len(window) > RATE_LIMIT:
        raise HTTPException(429, "too many runs from this address, slow down")

    def request_form():
        return {
            "blood_group": blood_group,
            "rhesus": rhesus,
            "units_needed": units_needed,
            "requester": requester,
        }

    errors = []
    if blood_group not in GROUPS:
        errors.append("blood group must be one of A, B, AB, O")
    if rhesus not in RHESUS:
        errors.append("rhesus must be positive or negative")
    if not 1 <= units_needed <= 10:
        errors.append("units needed must be between 1 and 10")
    if not bank_ids and not adhoc_phone.strip():
        errors.append("select at least one bank or enter an ad hoc number")

    bank_rows = []
    if bank_ids:
        try:
            ids = [uuidmod.UUID(b) for b in bank_ids]
        except ValueError:
            errors.append("invalid bank selection")
            ids = []
        if ids:
            bank_rows = await db.fetch(
                "select * from banks where active and id = any($1::uuid[])", ids
            )
            if len(bank_rows) != len(ids):
                errors.append("one or more selected banks are unavailable")

    adhoc_phone = adhoc_phone.strip()
    if adhoc_phone and not E164.match(adhoc_phone):
        errors.append("ad hoc number must be E.164, e.g. +15550101234")
    if adhoc_phone and not DRY_RUN and adhoc_phone not in allowed_destinations():
        errors.append(
            "live mode: ad hoc numbers must be pre-authorized in ALLOWED_DESTINATIONS"
        )

    total = len(bank_rows) + (1 if adhoc_phone else 0)
    if total > MAX_TARGETS:
        errors.append(f"a run is capped at {MAX_TARGETS} targets")

    if errors:
        return await _request_error(request, " ".join(errors), request_form())

    run = await db.fetchrow(
        "insert into call_runs (blood_group, rhesus, units_needed, requester)"
        " values ($1, $2, $3, $4) returning *",
        blood_group,
        rhesus,
        units_needed,
        requester.strip() or None,
    )

    targets: list[CallTarget] = []
    for row in bank_rows:
        key = f"run:{run['id']}:bank:{row['id']}:v1"
        result = await db.fetchrow(
            "insert into call_results"
            " (run_id, bank_id, source, bank_name, phone, idempotency_key)"
            " values ($1, $2, 'registry', $3, $4, $5) returning id",
            run["id"],
            row["id"],
            row["name"],
            row["phone"],
            key,
        )
        targets.append(
            CallTarget(
                result_id=result["id"],
                name=row["name"],
                phone=row["phone"],
                source="registry",
                idempotency_key=key,
                bank_id=row["id"],
                notes=row["notes"],
            )
        )

    if adhoc_phone:
        label = adhoc_label.strip() or adhoc_phone
        key = f"run:{run['id']}:number:{adhoc_phone}:v1"
        result = await db.fetchrow(
            "insert into call_results"
            " (run_id, source, bank_name, phone, idempotency_key)"
            " values ($1, 'adhoc', $2, $3, $4) returning id",
            run["id"],
            label,
            adhoc_phone,
            key,
        )
        targets.append(
            CallTarget(
                result_id=result["id"],
                name=label,
                phone=adhoc_phone,
                source="adhoc",
                idempotency_key=key,
                save_to_registry=adhoc_save == "on",
            )
        )

    spawn(dict(run), targets)
    return RedirectResponse(f"/runs/{run['id']}", status_code=303)


async def _request_error(request: Request, message: str, form: dict):
    banks = await db.fetch("select * from banks where active order by name")
    return render(
        request, "request.html", status_code=400, banks=banks, error=message, form=form
    )


@app.get("/runs")
async def runs_history(request: Request):
    blocked = gate(request)
    if blocked:
        return blocked
    runs = await db.fetch(
        """
        select r.*,
               count(c.id) as targets,
               count(c.id) filter (where c.status = 'completed') as completed,
               count(c.id) filter (where c.status = 'no_answer') as no_answer,
               count(c.id) filter (where c.status = 'callback_requested') as callbacks,
               count(c.id) filter (where c.status = 'failed') as failed
        from call_runs r
        left join call_results c on c.run_id = r.id
        group by r.id
        order by r.created_at desc
        limit 100
        """
    )
    return render(request, "runs.html", runs=runs)


@app.get("/runs/{run_id}")
async def run_page(request: Request, run_id: uuidmod.UUID):
    blocked = gate(request)
    if blocked:
        return blocked
    run = await db.fetchrow("select * from call_runs where id = $1", run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    return render(request, "run.html", run=run)


@app.get("/runs/{run_id}/cards")
async def run_cards(request: Request, run_id: uuidmod.UUID):
    blocked = gate(request)
    if blocked:
        return blocked
    run = await db.fetchrow("select * from call_runs where id = $1", run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    rows = await db.fetch(
        "select * from call_results where run_id = $1 order by created_at", run_id
    )
    shortlist = sorted(
        (r for r in rows if r["status"] == "completed" and (r["units_available"] or 0) > 0),
        key=lambda r: (
            -(r["units_available"] or 0),
            r["transport_minutes"] if r["transport_minutes"] is not None else 1 << 30,
        ),
    )
    return render(request, "cards.html", rows=rows, shortlist=shortlist)
