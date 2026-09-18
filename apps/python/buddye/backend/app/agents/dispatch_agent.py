"""Which resource goes to which address, and why.

The division of labour is the same one the reconciler uses, and it is the reason this is safe to run
on a free-tier model: **code filters, the model ranks, code validates.** `app/domain/fleet.py` has
already decided which assets are legally eligible — available, in range, right capability, capacity
left — and computed each one's real distance and ETA from real coordinates. This module hands that
shortlist to a model whose entire job is to pick one of them and say why in a sentence a coordinator
can act on. It is then re-validated here before anything is committed.

So the model cannot:

* **invent an asset** — a choice that is not in the shortlist is refused, and the deterministic pick
  is used instead;
* **do arithmetic** — distances and ETAs are given to it and copied back from the record, never from
  the reply, because a model that is confidently wrong about a number would put a wrong ETA on a
  coordinator's screen;
* **auto-dispatch an ambulance** — `requires_authorisation` is re-derived here from
  `domain.state.requires_authorisation(kind)`, never copied from the candidate or the reply, so an
  EMS_UNIT proposal is a REQUEST that sits visible and unsent until a named human approves it.

What the model genuinely adds is the judgment between two legal options — the nurse four minutes
further out is the right call for the woman who sounded confused, the water truck is right for the
man who just needs water — and the one-sentence justification that makes an agency request a single
informed click instead of a form. Everything else in this file exists to make that contribution
safe.

**This module never writes a Dispatch row.** It returns a proposal. Committing it, and enforcing
the authorisation gate at commit time, belongs to the dispatch layer.

Contract with the caller: candidates arrive **already filtered and already in the deterministic rank
order** fleet computed, so the fallback pick is `candidates[0]`. This module deliberately does not
re-sort them — fleet's rank may weigh capability or priority as well as ETA, and a second ranker
here quietly disagreeing with the first is exactly the kind of split-brain that makes a coordinator
stop trusting the board.

A note for the caller, and it is not a style preference: **do not hold a database session open across
a call to one of these agents.** The model takes 20-100 s on the free tier, sqlite is in WAL mode with
a five-second busy timeout, and the provenance write would sit behind your open transaction, stall for
five seconds and then be lost. Either call the agent with no session open, or pass your own session as
`session=` and the row is written into it.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, asdict
from typing import Any, Callable, Sequence

from app import obs
from app.agents.client import AgentClient, record_action
from app.domain.state import AssetKind, requires_authorisation

log = logging.getLogger("buddye.agents.dispatch")

AGENT = "dispatch_agent"
ACTION_KIND = "dispatch_proposal"

SYSTEM = (
    "You are the dispatch officer of a neighbourhood emergency operations centre during a hazard — "
    "extreme heat, a power cut, a flood. An automated welfare call has just found somebody on a block "
    "captain's list who needs something, and a shortlist of resources that could go to them has already "
    "been prepared for you. Your job is to choose one of them and say why, in one sentence a coordinator "
    "can act on without asking a follow-up question.\n\n"
    "THE SHORTLIST IS THE WHOLE WORLD. Every asset you may choose is in it, each with an id. Choosing "
    "anything else — an asset you remember, an agency you think should be called, a unit that would be "
    "ideal if it existed — is refused by the system and wastes the coordinator's time. Return the id "
    "exactly as it appears.\n\n"
    "DO NOT DO ARITHMETIC. The distance and the ETA of every candidate were computed from real "
    "coordinates and are given to you. Never estimate, adjust, or recompute one, and never write a "
    "number into your reason that is not in front of you. You are choosing between options, not "
    "measuring them.\n\n"
    "CHOOSE ON FIT, NOT ONLY ON SPEED. The nearest is usually right and is already listed first, so "
    "prefer it unless something about this person makes another candidate clearly better: what they "
    "actually need (water, a ride, power for equipment, someone who can assess them), whether they can "
    "get to the door, whether they are alone, and how bad it sounds. Four extra minutes for a nurse who "
    "can assess a confused person is a good trade. Four extra minutes for the same case of water is not.\n\n"
    "AGENCY UNITS ARE DIFFERENT. Some candidates are agency resources — an ambulance, a fire crew, a "
    "police welfare check. Those are flagged, and a request for one does NOT go anywhere: it is prepared "
    "and a named human approves it with one click, or does not. Ask for one when the record shows "
    "something a neighbour with water cannot fix — a person who cannot be roused, chest pain, "
    "breathlessness at rest, a fall they cannot get up from, confusion that came on today, life-support "
    "equipment already off with no backup left, or a house nobody has been able to reach when the person "
    "inside depends on power to stay alive.\n\n"
    "THE STANDARD FOR AN AGENCY JUSTIFICATION: name what specifically about THIS person, RIGHT NOW, "
    "needs a paramedic rather than a neighbour with water — the finding, the condition it acts on, and "
    "how long it has been going on, in the record's own terms. \"High risk\", \"elderly and alone\", "
    "\"to be safe\" and \"seems serious\" are not justifications; they are why she was called in the "
    "first place. A false ambulance call takes a unit away from somebody else's emergency, and the "
    "person approving it has seconds to decide, so give them the fact that decides it. If you cannot "
    "point to such a fact, choose a community resource instead — that is the honest answer, not a "
    "cautious one.\n\n"
    "DO NOT INVENT WHAT THE PERSON SAID OR HOW THEY ARE. Use the findings and quotes you are given. If "
    "the record does not establish something, it is not a reason.\n\n"
    "Reply with a single JSON object and nothing else — no prose, no markdown fences:\n"
    '{"asset_id": "<id from the shortlist>", "reason": "<one sentence: why this asset for this person '
    'now>", "agency_request": <true only if the chosen asset is an agency unit>, "justification": '
    '"<empty string unless agency_request is true; then the specific fact that needs a paramedic>"}'
)


@dataclass(frozen=True)
class DispatchProposal:
    """A recommendation, not a dispatch. The dispatch layer commits it, and a human approves it when
    `requires_authorisation` is true."""

    asset_id: str
    call_sign: str
    kind: str
    requires_authorisation: bool  # re-derived from domain.state, never copied from a model reply
    eta_minutes: float           # copied from the candidate record, never from the reply
    distance_miles: float
    reason: str
    justification: str = ""      # agency requests only; what needs a paramedic, specifically
    source: str = "deterministic"  # model | deterministic
    fallback_reason: str = ""    # why the model's answer was not used, when it was not
    model: str = ""
    latency_ms: int | None = None
    action_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _get(candidate: Any, *names: str, default: Any = None) -> Any:
    """Read a field from a candidate that may be a dict, a SQLModel row, or a dataclass.

    fleet.py is written alongside this module; tolerating both shapes means a rename there costs a
    field falling back to its default rather than an exception inside a sweep.
    """
    for name in names:
        if isinstance(candidate, dict):
            if name in candidate and candidate[name] is not None:
                return candidate[name]
        else:
            value = getattr(candidate, name, None)
            if value is not None:
                return value
    return default


def _view(candidate: Any) -> dict[str, Any] | None:
    """Normalise one candidate. Returns None if it has no id — an asset we cannot name we cannot send."""
    asset_id = _get(candidate, "asset_id", "id", default="")
    if not asset_id:
        return None
    kind = str(_get(candidate, "kind", default="") or "")
    # `spare_capacity` and `matched` are what fleet.Candidate calls these; the other spellings are
    # what a plain dict or an Asset row uses. Reading both means neither side has to convert.
    capacity_remaining = _get(candidate, "capacity_remaining", "remaining_capacity", "spare_capacity")
    if capacity_remaining is None:
        capacity = _get(candidate, "capacity", default=None)
        served = _get(candidate, "served_this_shift", default=0) or 0
        capacity_remaining = (capacity - served) if isinstance(capacity, (int, float)) else None
    try:
        agency = requires_authorisation(kind)
    except ValueError:
        # An unknown kind is not assumed safe. It cannot be auto-dispatched, and the choice is
        # refused below; failing towards "a human decides" is the only defensible direction.
        agency = True
    return {
        "asset_id": str(asset_id),
        "call_sign": str(_get(candidate, "call_sign", default="") or ""),
        "kind": kind,
        "operator_name": str(_get(candidate, "operator_name", default="") or ""),
        "capabilities": list(_get(candidate, "capabilities", "matched", default=[]) or [])
        + list(_get(candidate, "preferred_matched", default=[]) or []),
        "capacity_remaining": capacity_remaining,
        "eta_minutes": float(_get(candidate, "eta_minutes", "eta_min", default=0.0) or 0.0),
        "distance_miles": float(_get(candidate, "distance_miles", "miles", default=0.0) or 0.0),
        "requires_authorisation": agency,
        "kind_known": kind in set(AssetKind),
        # The candidate exactly as the caller passed it, kept so re-validation can be handed the
        # real asset rather than a copy of the few fields this module happens to read.
        "candidate": candidate,
    }


def _deterministic_reason(view: dict[str, Any], needs: Sequence[str]) -> str:
    """The reason line when no model was involved. Facts only, which is why it is a safe fallback."""
    bits = [f"{view['call_sign'] or view['asset_id']} is the nearest eligible unit"]
    if view["distance_miles"]:
        bits.append(f"{view['distance_miles']:.1f} mi out, ETA {view['eta_minutes']:.0f} min")
    else:
        bits.append(f"ETA {view['eta_minutes']:.0f} min")
    matched = [n for n in needs if n in view["capabilities"]]
    if matched:
        bits.append("carries " + ", ".join(matched))
    return "; ".join(bits) + "."


def _deterministic_justification(view: dict[str, Any], risk_reasons: Sequence[str], findings: Sequence[str]) -> str:
    """An agency request assembled by code: the record's own reasons, quoted as reasons, nothing added.

    Thinner than a good model sentence on purpose. A human reads it and decides; what they must not
    get is a fluent justification for a fact nobody recorded.
    """
    if not view["requires_authorisation"]:
        return ""
    grounds = [str(x) for x in list(findings) + list(risk_reasons) if str(x).strip()]
    if not grounds:
        return "Requested on the deterministic rule; no specific finding was recorded. Review before approving."
    return "On the record: " + "; ".join(grounds[:4]) + ". Assembled from the record, not written by a model."


def deterministic_proposal(
    views: list[dict[str, Any]],
    *,
    needs: Sequence[str] = (),
    risk_reasons: Sequence[str] = (),
    findings: Sequence[str] = (),
    fallback_reason: str = "",
) -> DispatchProposal:
    """The answer this layer degrades to: fleet's own top-ranked candidate, described factually."""
    view = views[0]
    return DispatchProposal(
        asset_id=view["asset_id"],
        call_sign=view["call_sign"],
        kind=view["kind"],
        requires_authorisation=view["requires_authorisation"],
        eta_minutes=view["eta_minutes"],
        distance_miles=view["distance_miles"],
        reason=_deterministic_reason(view, needs),
        justification=_deterministic_justification(view, risk_reasons, findings),
        source="deterministic",
        fallback_reason=fallback_reason,
    )


def build_prompt(
    *,
    hazard: dict[str, Any],
    incident: dict[str, Any],
    situation: dict[str, Any],
    risk_reasons: Sequence[str],
    views: list[dict[str, Any]],
) -> str:
    """What the model sees. Redacted, because this is the payload that leaves the machine."""
    shortlist = [
        {
            "asset_id": v["asset_id"],
            "call_sign": v["call_sign"],
            "kind": v["kind"],
            "capabilities": v["capabilities"],
            "capacity_remaining": v["capacity_remaining"],
            "distance_miles": round(v["distance_miles"], 2),
            "eta_minutes": round(v["eta_minutes"], 1),
            "agency_unit_needs_human_approval": v["requires_authorisation"],
        }
        for v in views
    ]
    parts = [
        "Hazard:\n" + json.dumps(obs.redact(hazard), indent=1, default=str),
        "Incident (what the welfare call found):\n" + json.dumps(obs.redact(incident), indent=1, default=str),
        # The person, in the record's terms: what they said, what they need, how they live. This is
        # the health information the choice actually turns on, so it is sent; the redaction above
        # strips the phone numbers, which have no bearing on which van to send.
        "The person and their situation:\n" + json.dumps(obs.redact(situation), indent=1, default=str),
        "Why triage put them where it did:\n"
        + ("\n".join(f"  - {r}" for r in risk_reasons) if risk_reasons else "  (not recorded)"),
        "Shortlist — every asset you may choose, already checked as available, in range, capable and "
        "with capacity, listed nearest first with distances and ETAs computed from real coordinates:\n"
        + json.dumps(shortlist, indent=1),
    ]
    return "\n\n".join(parts)


def _resolve_choice(data: dict[str, Any], views: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    """Turn a model reply into a candidate, or say why it cannot be one."""
    by_id = {v["asset_id"]: v for v in views}
    chosen_id = str(data.get("asset_id") or data.get("id") or "").strip()
    if chosen_id in by_id:
        return by_id[chosen_id], ""
    # A model that answers with the call sign is answering the question, just not in the format
    # asked for; a coordinator would accept "send WV-2". An id that does not exist is a different
    # thing entirely and is refused.
    call_sign = str(data.get("call_sign") or "").strip().upper()
    if call_sign:
        for v in views:
            if v["call_sign"].upper() == call_sign:
                return v, ""
    if chosen_id:
        return None, f"model chose an asset that is not on the shortlist ({chosen_id!r})"
    return None, "model reply named no asset"


async def propose_dispatch(
    *,
    hazard_id: str,
    hazard: dict[str, Any] | None = None,
    incident: dict[str, Any] | None = None,
    incident_id: str | None = None,
    situation: dict[str, Any] | None = None,
    risk_reasons: Sequence[str] = (),
    findings: Sequence[str] = (),
    needs: Sequence[str] = (),
    candidates: Sequence[Any],
    client: AgentClient | None = None,
    validate: Callable[[Any], Any] | None = None,
    session: Any = None,
) -> DispatchProposal | None:
    """Propose one asset for one incident. Returns None only when nothing is eligible.

    `candidates` are fleet's already-filtered, already-ranked eligible assets with their computed
    ETAs — `fleet.Candidate` objects, plain dicts or Asset rows all read correctly. `validate` is
    fleet's re-check of the final choice; it is given the chosen candidate as passed in, and see
    `_check_legal` for what happens when it is not supplied.

    An `OperatorAction` row is written on every path, including "nothing was eligible" and "the model
    timed out" — how a decision was reached is part of the decision. Pass `session` if you are holding
    one; see the module docstring for why you must not hold one across this call otherwise.
    """
    hazard = hazard or {}
    incident = incident or {}
    situation = situation or {}
    views = [v for v in (_view(c) for c in candidates) if v is not None]

    inputs: dict[str, Any] = {
        "incident_id": incident_id,
        "needs": list(needs),
        "risk_reasons": list(risk_reasons),
        "findings": list(findings),
        "candidates": [
            {"asset_id": v["asset_id"], "call_sign": v["call_sign"], "kind": v["kind"],
             "eta_minutes": round(v["eta_minutes"], 1), "distance_miles": round(v["distance_miles"], 2)}
            for v in views
        ],
    }

    if not views:
        # Not an error to swallow: a coordinator needs to know an incident got no proposal because
        # the fleet had nothing legal to send, not because an agent was never asked.
        record_action(
            hazard_id=hazard_id, incident_id=incident_id, kind=ACTION_KIND, agent=AGENT,
            model=(client.model if client else ""), inputs=inputs, output={},
            rationale="No eligible asset: nothing available, in range and capable.",
            error="no eligible candidates", session=session,
        )
        return None

    if client is None:
        proposal = deterministic_proposal(
            views, needs=needs, risk_reasons=risk_reasons, findings=findings,
            fallback_reason="no model configured",
        )
        action_id = record_action(
            hazard_id=hazard_id, incident_id=incident_id, kind=ACTION_KIND, agent=AGENT,
            inputs=inputs, output=proposal.as_dict(), rationale=proposal.reason, session=session,
        )
        return DispatchProposal(**{**proposal.as_dict(), "action_id": action_id})

    user = build_prompt(hazard=hazard, incident=incident, situation=situation,
                        risk_reasons=risk_reasons, views=views)
    call = await client.complete_json(agent=AGENT, system=SYSTEM, user=user)

    fallback_reason = ""
    proposal: DispatchProposal | None = None
    if call.data is None:
        fallback_reason = call.error or "no reply"
    else:
        view, why = _resolve_choice(call.data, views)
        if view is None:
            fallback_reason = why
        elif not view["kind_known"]:
            # An asset whose kind is not in AssetKind cannot be checked against the authorisation
            # policy, so it is not committed on a model's say-so.
            fallback_reason = f"chosen asset has an unrecognised kind ({view['kind']!r})"
        else:
            reason = str(call.data.get("reason") or call.data.get("rationale") or "").strip()
            justification = str(call.data.get("justification") or "").strip()
            legal, why = _check_legal(view["candidate"], incident=incident, needs=needs, validate=validate)
            if not legal:
                fallback_reason = why
            elif view["requires_authorisation"] and not justification:
                # An agency request with no justification is the one model output that must not
                # reach a coordinator: it asks a person to spend an ambulance on "trust me".
                fallback_reason = "agency unit requested without a justification"
            elif not reason:
                fallback_reason = "model gave no reason"
            else:
                proposal = DispatchProposal(
                    asset_id=view["asset_id"],
                    call_sign=view["call_sign"],
                    kind=view["kind"],
                    # Derived here, from the single source of truth. Not from the candidate row and
                    # not from the reply: this flag is what stands between a proposal and an
                    # ambulance, and it is not a model's to set.
                    requires_authorisation=requires_authorisation(view["kind"]),
                    eta_minutes=view["eta_minutes"],       # from the record; the model does not do
                    distance_miles=view["distance_miles"],  # arithmetic and is not asked to
                    reason=reason,
                    justification=justification if view["requires_authorisation"] else "",
                    source="model",
                    model=call.model,
                    latency_ms=call.latency_ms,
                )

    if proposal is None:
        log.info("dispatch_agent.fallback reason=%s", fallback_reason)
        base = deterministic_proposal(views, needs=needs, risk_reasons=risk_reasons, findings=findings,
                                      fallback_reason=fallback_reason)
        # Say so in the rationale: a coordinator reading "the nearest unit" is entitled to know
        # whether that was a judgment or a default.
        proposal = DispatchProposal(**{
            **base.as_dict(),
            # The coordinator reads `reason`; a stack trace or a gateway's 401 body has no business in
            # it. Provenance stays exact in `source` and `fallback_reason`, which the audit trail keeps.
            "reason": base.reason,
            "model": call.model,
            "latency_ms": call.latency_ms,
        })

    action_id = record_action(
        hazard_id=hazard_id, incident_id=incident_id, kind=ACTION_KIND, agent=AGENT,
        model=call.model, inputs=inputs,
        output={**proposal.as_dict(), "raw": call.data},
        rationale=proposal.reason, latency_ms=call.latency_ms,
        error=call.error or (fallback_reason or None), session=session,
    )
    return DispatchProposal(**{**proposal.as_dict(), "action_id": action_id})


def _check_legal(
    candidate: Any,
    *,
    incident: dict[str, Any],
    needs: Sequence[str],
    validate: Callable[[Any], Any] | None,
) -> tuple[bool, str]:
    """Fleet's re-validation of the final choice.

    Membership of the shortlist has already been checked by the caller and stands on its own; this
    is the second gate, the one that catches the nurse who was committed to another incident in the
    twenty seconds the model spent thinking.

    `validate` is injected by the dispatch layer and is given the chosen candidate exactly as it was
    passed in. Without it, `fleet.validate_choice(asset, incident, needs)` is called directly — but
    only when the incident carries coordinates, because fleet (correctly) refuses to validate an
    incident it cannot compute a distance to, and a refusal for *that* reason would silently disable
    the model layer for every caller who passed a thin incident dict rather than the row. Fleet's own
    gate runs again at commit time regardless; nothing here is the last line of defence.

    An exception from a validator is a refusal, not a pass: when the gate itself is broken, the safe
    direction is the deterministic pick.
    """
    if validate is None:
        if not (incident.get("lat") and incident.get("lon")):
            log.debug("dispatch_agent.revalidation_skipped reason=incident has no coordinates")
            return True, ""
        try:
            from app.domain import fleet  # noqa: PLC0415  — lazy: keeps this module importable alone

            asset = getattr(candidate, "asset", None) or candidate
            result: Any = fleet.validate_choice(asset, incident, list(needs) or None)
        except Exception as exc:  # noqa: BLE001
            log.warning("dispatch_agent.revalidation_error error=%s", type(exc).__name__)
            return False, f"fleet refused the choice ({type(exc).__name__})"
    else:
        try:
            result = validate(candidate)
        except Exception as exc:  # noqa: BLE001
            return False, f"fleet refused the choice ({type(exc).__name__})"

    if isinstance(result, tuple) and len(result) == 2:  # a validator may answer (ok, reason)
        ok, why = result
        return bool(ok), "" if ok else str(why or "fleet re-validation refused the choice")
    # fleet.ValidationResult is falsy when it refuses and carries the sentence a coordinator reads.
    if not result:
        why = str(getattr(result, "reason", "") or "fleet re-validation refused the choice")
        return False, why
    return True, ""
