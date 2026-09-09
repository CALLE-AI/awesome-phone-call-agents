EXTRACTION_SCHEMA = {
    "type": "object",
    "required": ["units_available", "release_policy"],
    "additionalProperties": False,
    "properties": {
        "units_available": {
            "type": "integer",
            "description": (
                "Number of units of the exact requested blood group and rhesus "
                "currently in stock and available. Use 0 if they have none. "
                "Only give a number the bank actually stated."
            ),
        },
        "release_policy": {
            "type": "string",
            "enum": ["will_release", "collect_only", "refused", "unknown"],
            "description": (
                "will_release: they will release the units to our facility. "
                "collect_only: we must collect in person. refused: they will "
                "not give us the units. unknown: unclear or not asked."
            ),
        },
        "group_confirmed": {
            "type": "string",
            "enum": ["A", "B", "AB", "O", "unknown"],
            "description": (
                "The blood group the bank confirmed they have, if it came up. "
                "unknown if not discussed."
            ),
        },
        "screening_status": {
            "type": "string",
            "enum": [
                "screened_ready",
                "crossmatch_pending",
                "unscreened",
                "unknown",
            ],
            "description": (
                "screened_ready: units are screened and ready for cross match. "
                "crossmatch_pending: screening done, cross match still to do. "
                "unscreened: not yet screened. unknown if unclear."
            ),
        },
        "transport_minutes": {
            "type": "integer",
            "description": (
                "Estimated minutes to delivery, or to complete collection if "
                "collection only. Only if the bank stated or clearly implied a "
                "time; otherwise omit."
            ),
        },
        "cost_per_unit": {
            "type": "number",
            "description": "Price per unit as quoted. Omit if not quoted.",
        },
        "contact_person": {
            "type": "string",
            "description": "Name or role of the person to ask for on arrival.",
        },
        "callback_requested": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "yes only if the bank said someone will call us back with the "
                "answer. This is not a failure; record it and move on."
            ),
        },
        "alternatives": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Alternatives offered when they have none of the requested "
                "group: compatible groups, other products, or a sister branch. "
                "Empty list if none offered."
            ),
        },
    },
}

_QUESTIONS = [
    "How many units of {group} they currently have available",
    "The screening and cross match status of those units",
    "Whether they will release the units to our facility, or whether it is collection in person only",
    "The cost per unit",
    "Roughly how long delivery or collection would take, in minutes",
    "Who to ask for on arrival",
    "If they have none: whether they can offer compatible alternatives, another group, or a sister branch",
]


def build_task(run: dict, bank_name: str, notes: str | None) -> str:
    group = f"{run['blood_group']} {'negative' if run['rhesus'] == 'negative' else 'positive'}"
    requester = run.get("requester") or "a medical facility"
    lines = [
        f"You are calling {bank_name} on behalf of {requester}.",
        f"We urgently need {run['units_needed']} unit(s) of {group} blood for a patient at the facility.",
    ]
    if notes:
        lines.append(f"Note about this blood bank: {notes}")
    lines.append("Politely ask, in this order:")
    lines += [f"{i}. {q.format(group=group)}" for i, q in enumerate(_QUESTIONS, 1)]
    lines += [
        "Ask each question once. If an answer is unclear, paraphrase it at most once, then move on.",
        "When you have asked everything, or they have no stock, thank them and end the call. Do not repeat questions.",
        "You are gathering information only. Never promise, reserve, book, or commit to anything on anyone's behalf.",
        "If they ask you to confirm a reservation or place an order, say that someone from the facility will call back to confirm.",
        "If they say someone will call us back with the answer, record that as a callback request and end the call politely.",
    ]
    return "\n".join(lines)
