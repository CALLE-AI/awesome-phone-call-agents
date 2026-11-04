"""Validate LLM/replay suggestions before exposing any CRM write operation."""
import re
from ..storage import digest


def evidence_record(run, evidence):
    turns = run["call"]["transcript"]
    i = evidence.turn_index
    if i >= len(turns) or turns[i].get("speaker") != "user" or evidence.quote not in turns[i].get("text", ""):
        raise ValueError('No matching user transcript quote')
    return {**evidence.model_dump(), "run_id":run["id"], "snapshot_id":digest(turns),
            "call_resource_id":run["call"]["id"], "offset_seconds":turns[i].get("offset_seconds")}


def property_attribution(run, property_id, evidence):
    """Conservative attribution: exact alias in quoted turn or prior bot question.

    Ambiguous references stay unresolved. This rule checks provenance, not the
    truth of an LLM's sentiment interpretation.
    """
    views = {v["property_id"]:v for v in run["context"]["viewings"]}
    if property_id not in views:
        raise ValueError('Not a selected viewing property for this customer')
    props = {p["id"]:p for p in run["context"]["properties"]}
    alias = props[property_id]["label"].split()[0]
    def mentions(alias, text):
        # A/B are property aliases, not arbitrary letters in words like AI.
        return bool(re.search(r"(?<![A-Za-z])"+re.escape(alias)+r"(?![A-Za-z])", text))
    text = evidence.quote
    # Only a single-property question can supply a missing antecedent.
    if not mentions(alias,text):
        i = evidence.turn_index
        previous = run["call"]["transcript"][i-1] if i else {}
        other_aliases = [props[x]["label"].split()[0] for x in views if x != property_id]
        if previous.get("speaker") != "bot" or not mentions(alias,previous.get("text", "")) or any(mentions(a,previous.get("text", "")) for a in other_aliases):
            raise ValueError('Property reference is unclear; automatic attribution blocked')
    return views[property_id]


def validate_value(field, value):
    if field in {"budget_max","bedrooms"}:
        ceiling = 1000000000 if field == "budget_max" else 30
        return type(value) is int and 0 < value <= ceiling
    if field == "contact_allowed":
        return type(value) is bool and value is False
    return isinstance(value,str) and bool(value.strip()) and len(value) <= 2000


def build_batch(run, analysis):
    customer = run["context"]["customer"]
    accepted, pending, signals = [], [], []
    unresolved = list(analysis.unresolved)
    seen = set()
    def pending_item(entry, message):
        entry["reason"] = message
        entry["status"] = "review_required"
        pending.append(entry)
    for proposed in analysis.changes:
        old = customer.get(proposed.field) if proposed.field == "contact_allowed" else customer["preferences"].get(proposed.field)
        entry = {"id":digest([run["id"],"preference",proposed.field]), "kind":"preference", "target_id":customer["id"],
                 "field":proposed.field, "old_value":old, "value":proposed.value, "reason":proposed.reason, "evidence":None}
        try:
            entry["evidence"] = evidence_record(run, proposed.evidence)
            if proposed.field in seen:
                raise ValueError('Conflicting conclusions for one field require review')
            seen.add(proposed.field)
            if proposed.uncertain or not validate_value(proposed.field, proposed.value):
                raise ValueError('Ambiguous statement or unknown new value; retain the old value')
            quote=proposed.evidence.quote
            if proposed.field == "contact_allowed" and not (
                    re.search('stop|do not|do not call|no more calls',quote,re.I) and
                    re.search('call|contact',quote,re.I)):
                raise ValueError('Contact restriction lacks explicit refusal evidence')
            if old == proposed.value:
                continue
            if proposed.field in {"budget_max","bedrooms","preferred_area"}:
                raise ValueError('High-impact field changes require broker review')
            # A literal quote alone does not establish semantic support. Keep
            # the auto-write scope small; unsupported phrasings go to review.
            supports = {
                "living_room_priority": bool(re.search('living[- ]room|space',quote,re.I) and re.search('more important|priority|important|matters more',quote,re.I)),
                "subway_preference": bool(re.search('subway|metro|transport|commute',quote,re.I) and re.search('accept|relax|farther|longer',quote,re.I)),
                "purchase_timeline": False,
                "next_viewing_interest": bool(re.search('suitable',quote,re.I) and re.search('view again|willing|another viewing|arrange',quote,re.I)),
            }
            if proposed.field in supports and not supports[proposed.field]:
                raise ValueError('The quote does not support automatically changing this preference; review required')
            accepted.append(entry)
        except ValueError as exc:
            pending_item(entry,str(exc))
    # If contradictory proposals reuse a field, remove every automatic update
    # for it; never let the first suggestion win by ordering.
    duplicates = {c.field for c in analysis.changes if sum(x.field == c.field for x in analysis.changes)>1}
    for entry in list(accepted):
        if entry["field"] in duplicates:
            accepted.remove(entry);pending_item(entry,'Multiple conclusions for one field; awaiting review')
    feedback_keys, duplicate_feedback = set(), set()
    for proposed in analysis.feedback:
        entry = {"kind":"feedback","property_id":proposed.property_id,"field":proposed.dimension,
                 "value":proposed.text,"old_value":None,"evidence":None,
                 "id":digest([run["id"],"feedback",proposed.property_id,proposed.dimension])}
        try:
            entry["evidence"] = evidence_record(run,proposed.evidence)
            view = property_attribution(run,proposed.property_id,proposed.evidence)
            entry["target_id"] = view["id"]
            if proposed.uncertain or not proposed.text.strip():
                raise ValueError('Ambiguous property feedback')
            if entry["id"] in feedback_keys:
                duplicate_feedback.add(entry["id"])
                raise ValueError('Duplicate property dimension requires review')
            feedback_keys.add(entry["id"])
            accepted.append(entry)
        except ValueError as exc:
            pending_item(entry,str(exc))
    for entry in list(accepted):
        if entry["id"] in duplicate_feedback:
            accepted.remove(entry)
            pending_item(entry,'Multiple conclusions for one property dimension; none adopted automatically')
    for signal in analysis.signals:
        try:
            ev = evidence_record(run,signal.evidence)
            property_attribution(run,signal.property_id,signal.evidence)
            signals.append({**signal.model_dump(),"evidence":ev})
        except ValueError as exc:
            unresolved.append('Opportunity signal not adopted: '+str(exc))
    suppressed = any(e["field"] == "contact_allowed" and e["value"] is False for e in accepted)
    reported_contact=(run["call"].get("result") or {}).get("contact_preference", "")
    reported_refusal=isinstance(reported_contact,str) and reported_contact.strip().lower() in {
        "do_not_contact", "stop", "no_contact", 'Refuses contact', 'Do not contact', 'Do not contact'}
    contact_uncertain = any(e["field"] == "contact_allowed" for e in pending) or (reported_refusal and not suppressed)
    if reported_refusal and not suppressed:
        unresolved.append('Structured result reports contact refusal without usable original evidence; block another call pending human review.')
    handoff = assess_handoff(signals, suppressed or contact_uncertain)
    return {"expected_version":customer["version"], "accepted":accepted,"pending":pending,
            "unresolved":unresolved, "handoff":handoff,"contact_review_block":contact_uncertain}


def assess_handoff(signals, suppressed=False):
    if suppressed:
        return {"priority":"suppressed", "reason":'Contact refusal or permission uncertainty: stop sales actions', "signals":signals,"action":'Verify and respect contact restrictions'}
    explicit = []
    for s in signals:
        quote = s["evidence"]["quote"]
        action = re.search('revisit|buy|purchase|view again',quote,re.I)
        timing = s["timeframe"] not in {"","unknown",'Unknown'} and re.search('this week|tomorrow|weekend|near term',quote,re.I)
        if s["kind"] in {"revisit","purchase"} and action and timing:
            explicit.append(s)
    if explicit:
        return {"priority":"high", "reason":'Specific property plus explicit near-term action; priority is a recommendation, not a conversion probability', "signals":signals,
                "action":'Broker to verify negotiation conditions and coordinate a revisit; no appointment or price promised'}
    return {"priority":"normal", "reason":'Viewing interest is not strong purchase intent for a specific home; insufficient explicit near-term action evidence', "signals":signals,"action":'Retain preferences; let the broker decide follow-up according to customer wishes'}
