"""Validate LLM/replay suggestions before exposing any CRM write operation."""
import re
from ..storage import digest


def evidence_record(run, evidence):
    turns = run["call"]["transcript"]
    i = evidence.turn_index
    if i >= len(turns) or turns[i].get("speaker") != "user" or evidence.quote not in turns[i].get("text", ""):
        raise ValueError("没有匹配的用户转写原话")
    return {**evidence.model_dump(), "run_id":run["id"], "snapshot_id":digest(turns),
            "call_resource_id":run["call"]["id"], "offset_seconds":turns[i].get("offset_seconds")}


def property_attribution(run, property_id, evidence):
    """Conservative attribution: exact alias in quoted turn or prior bot question.

    Ambiguous references stay unresolved. This rule checks provenance, not the
    truth of an LLM's sentiment interpretation.
    """
    views = {v["property_id"]:v for v in run["context"]["viewings"]}
    if property_id not in views:
        raise ValueError("不是本次客户已选的带看房源")
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
            raise ValueError("房源指代不清，不能自动归属")
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
                raise ValueError("同字段多项结论冲突，需人工核对")
            seen.add(proposed.field)
            if proposed.uncertain or not validate_value(proposed.field, proposed.value):
                raise ValueError("表达含糊或新值未知，保持原值")
            quote=proposed.evidence.quote
            if proposed.field == "contact_allowed" and not (
                    re.search(r"不要|别再|停止|别打|stop|do not",quote,re.I) and
                    re.search(r"电话|联系|别打|call|contact",quote,re.I)):
                raise ValueError("联系限制没有明确拒绝联系的依据")
            if old == proposed.value:
                continue
            if proposed.field in {"budget_max","bedrooms","preferred_area"}:
                raise ValueError("高影响字段变更需经纪人核对后确认")
            # A literal quote alone does not establish semantic support. Keep
            # the auto-write scope small; unsupported phrasings go to review.
            supports = {
                "living_room_priority": bool(re.search(r"客厅|空间|living room|space",quote,re.I) and re.search(r"更重要|优先|important|priority",quote,re.I)),
                "subway_preference": bool(re.search(r"地铁|交通|subway|metro|commute",quote,re.I) and re.search(r"接受|放宽|远一点|accept|relax|farther",quote,re.I)),
                "purchase_timeline": False,
                "next_viewing_interest": bool(re.search(r"合适|suitable",quote,re.I) and re.search(r"再约|再看|愿意|view again",quote,re.I)),
            }
            if proposed.field in supports and not supports[proposed.field]:
                raise ValueError("原话不足以支持自动更改该偏好，需人工核对")
            accepted.append(entry)
        except ValueError as exc:
            pending_item(entry,str(exc))
    # If contradictory proposals reuse a field, remove every automatic update
    # for it; never let the first suggestion win by ordering.
    duplicates = {c.field for c in analysis.changes if sum(x.field == c.field for x in analysis.changes)>1}
    for entry in list(accepted):
        if entry["field"] in duplicates:
            accepted.remove(entry);pending_item(entry,"同字段多项结论，等待核对")
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
                raise ValueError("房源反馈含糊")
            if entry["id"] in feedback_keys:
                duplicate_feedback.add(entry["id"])
                raise ValueError("同房源维度出现重复，需核对")
            feedback_keys.add(entry["id"])
            accepted.append(entry)
        except ValueError as exc:
            pending_item(entry,str(exc))
    for entry in list(accepted):
        if entry["id"] in duplicate_feedback:
            accepted.remove(entry)
            pending_item(entry,"同房源维度存在多项结论，未自动采用任何一项")
    for signal in analysis.signals:
        try:
            ev = evidence_record(run,signal.evidence)
            property_attribution(run,signal.property_id,signal.evidence)
            signals.append({**signal.model_dump(),"evidence":ev})
        except ValueError as exc:
            unresolved.append("机会信号未采用："+str(exc))
    suppressed = any(e["field"] == "contact_allowed" and e["value"] is False for e in accepted)
    reported_contact=(run["call"].get("result") or {}).get("contact_preference", "")
    reported_refusal=isinstance(reported_contact,str) and reported_contact.strip().lower() in {
        "do_not_contact", "stop", "no_contact", "拒绝联系", "不再联系", "不要联系"}
    contact_uncertain = any(e["field"] == "contact_allowed" for e in pending) or (reported_refusal and not suppressed)
    if reported_refusal and not suppressed:
        unresolved.append("结构化结果报告拒绝联系，但缺少可用原话；暂阻止再次拨号，待人工核实。")
    handoff = assess_handoff(signals, suppressed or contact_uncertain)
    return {"expected_version":customer["version"], "accepted":accepted,"pending":pending,
            "unresolved":unresolved, "handoff":handoff,"contact_review_block":contact_uncertain}


def assess_handoff(signals, suppressed=False):
    if suppressed:
        return {"priority":"suppressed", "reason":"拒绝联系或联系权限需核实，停止销售动作", "signals":signals,"action":"核对并遵守联系限制"}
    explicit = []
    for s in signals:
        quote = s["evidence"]["quote"]
        action = re.search(r"复看|再.{0,5}看|购买|买下|revisit|buy|view again",quote,re.I)
        timing = s["timeframe"] not in {"","unknown","未知"} and re.search(r"本周|这周|明天|周末|近期|this week|tomorrow|weekend",quote,re.I)
        if s["kind"] in {"revisit","purchase"} and action and timing:
            explicit.append(s)
    if explicit:
        return {"priority":"high", "reason":"具体房源 + 明确近期推进诉求；优先级是建议，不是成交概率", "signals":signals,
                "action":"经纪人核实议价条件并联系协调复看，尚未预约或承诺价格"}
    return {"priority":"normal", "reason":"继续看房意愿不等于具体房源的强成交意向；暂无足够明确的近期推进证据", "signals":signals,"action":"保持需求记录，按客户意愿由经纪人决定后续"}
