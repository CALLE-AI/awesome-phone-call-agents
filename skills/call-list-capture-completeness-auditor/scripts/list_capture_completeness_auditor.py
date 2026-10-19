#!/usr/bin/env python3
"""call-list-capture-completeness-auditor - grade agent readback completeness.

Twin-mode heuristic skill:
  analyze  extract the item lists a CALLEE enumerated during the call, then
           grade whether the AGENT's readback/confirmation captured every
           item (dropped_items) and added nothing (added_items)
  craft    emit a readback-disciplined goal template

Runs offline, deterministic, no LLM, no network. Input errors exit 2.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

CALLEE_ROLES = {"callee", "customer", "called_party", "recipient", "human"}
AGENT_ROLES = {"agent", "assistant", "ai", "bot", "caller"}

SKILL_NAME = "call-list-capture-completeness-auditor"

DISCLAIMER = (
    "Heuristic text-only analysis of enumerated item lists and agent readback. "
    "Chunking and item matching are approximate for natural speech; every "
    "verdict routes to human review, never to automated claims about what was "
    "actually promised."
)

# Normalize the typographic apostrophe to ASCII so apostrophe-based patterns
# match real ASR output. Offset-preserving translate.
_SMART = str.maketrans({"\u2019": "'"})

_DIGIT_RUN_RE = re.compile(r"[0-9](?:[ .,\-/][0-9]|[0-9])*")

# Confirmation-cue regex (checked on the normalized sentence before any
# leading-marker stripping, so cues like "so that's ..." still fire).
CUE_RE = re.compile(
    r"(i have (?:you|that|us)"
    r"|let me (?:confirm|read (?:that|it) back)"
    r"|so (?:that(?:'s| is)|you (?:need|want|we have))"
    r"|just to confirm"
    r"|to recap"
    r"|did i get (?:that|everything)"
    r"|is that (?:everything|all|right)"
    r"|i(?:'ll| will) (?:put|note|add) (?:you|that|it) down for)",
    re.IGNORECASE,
)

# Discourse markers stripped from the start of a sentence before chunking,
# so greetings/fillers ("Hi, we need ...", "Uh, sure.") do not become items.
_LEAD_MARKERS_RE = re.compile(
    r"^(?:(?:also|plus|and|uh|um|ok|okay|well|hi|hello|hey|yes|yeah|so|please"
    r"|thanks|now|then|first|great|perfect|right|sure|alright"
    r"|actually|sorry|correction|wait|never mind|on second thought)\b[,;: ]*)+",
    re.IGNORECASE,
)

_CHUNK_SPLIT_RE = re.compile(r",|\band\b|\bplus\b|\bas well as\b")

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")

# Stopwords stripped from item chunk edges (spec set, matching only).
# Correction-discourse tokens ("actually", "sorry", "wait", "never mind",
# ...) are stripped so a correction preamble never becomes a chunk-item.
_ITEM_STOPWORDS = {
    "please", "maybe", "also", "well", "ok", "okay", "uh", "um", "thanks",
    "actually", "sorry", "correction", "wait", "never", "mind",
}

# Leading filler verb phrases stripped so the item is the noun phrase.
# The second alternative covers leading imperatives ("Add two salads ...").
_VERB_FILLER_RE = re.compile(
    r"^(?:(?:we|i|you)\s+(?:also\s+)?(?:need|wanted?|would\s+like|'d\s+like|'ll\s+take)"
    r"|(?:add|include|get|order|put\s+down))\s+"
)

# A correction sentence extends the active list instead of starting a new
# one, so the withdrawal inside it edits the list it corrects.
_CORRECTION_MARKER_RE = re.compile(
    r"^(?:actually|sorry|correction|wait|never mind|on second thought)\b",
    re.IGNORECASE,
)

# A negated chunk names an item being WITHDRAWN from the active list
# ("drop the late checkout", "no late checkout") rather than being a new
# item - but only when that item is already in the list; a first-mention
# negation ("no onions") is an item/modification.
_WITHDRAWAL_RE = re.compile(
    r"^(?:(?:drop|remove|cancel|forget|skip)\s+(?:the\s+)?|no\s+)(.+)$",
    re.IGNORECASE,
)

# Prepositional tail split: the last segment is the payload noun phrase.
_PREP_SPLIT_RE = re.compile(r"\b(?:on|in|at|for|with|near|by|around)\b")

_ARTICLE_RE = re.compile(r"^(?:a|an|the)\s+")
_QUANTIFIER_RE = re.compile(r"^((?:one|two|three|four|five|six|seven|eight|nine)|[1-9])\s+")

REVIEW_ACTION_BOTH = "rework the goal template readback: capture every item and drop invented ones"
REVIEW_ACTION_DROPPED = "add item-by-item readback to the goal template"
REVIEW_ACTION_ADDED = "remove unverifiable items from the confirmation script"
REVIEW_ACTION_NO_READBACK = "add a closing readback step to the goal template"


def mask_pii(text: str) -> str:
    """Mask any run of >= 7 digits (single separators glue the run).

    The whole run is replaced by one star per masked digit, keeping only the
    last 2 digits. Short runs (911, 988, times) pass through untouched.
    """

    def _mask(m: re.Match[str]) -> str:
        run = m.group(0)
        digit_count = sum(1 for ch in run if ch.isdigit())
        if digit_count < 7:
            return run
        return "*" * (digit_count - 2) + run[-2:]

    return _DIGIT_RUN_RE.sub(_mask, text)


def _normalize(text: str) -> str:
    return text.translate(_SMART)


def fold_plural(token: str) -> str:
    """Plural-fold a token for MATCHING only (salads -> salad)."""

    if len(token) >= 4 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def normalize_item(chunk: str) -> tuple[str, set[str], str | None]:
    """Normalize a chunk into (display, matching tokens, quantity note).

    Lowercase, strip leading discourse/stopword tokens and filler verb
    phrases, keep the last prepositional segment as the payload noun phrase,
    then strip articles, leading quantifier prefixes (remembered as a note),
    and edge stopwords.
    """
    s = chunk.lower()
    s = re.sub(r"[^a-z0-9\s']", " ", s)
    s = re.sub(r"\s+", " ", s).strip()

    # Leading stopwords and filler verb phrases.
    changed = True
    while changed and s:
        changed = False
        toks = s.split()
        if toks and toks[0] in _ITEM_STOPWORDS:
            s = " ".join(toks[1:])
            changed = True
            continue
        m = _VERB_FILLER_RE.match(s)
        if m:
            s = s[m.end():]
            changed = True

    # Prepositional tail: keep the last non-empty segment.
    segments = [p.strip() for p in _PREP_SPLIT_RE.split(s) if p.strip()]
    s = segments[-1] if segments else ""

    # Articles, quantifiers (remembered as a note), edge stopwords.
    note: str | None = None
    changed = True
    while changed and s:
        changed = False
        m = _ARTICLE_RE.match(s)
        if m:
            s = s[m.end():]
            changed = True
            continue
        m = _QUANTIFIER_RE.match(s)
        if m:
            note = m.group(1).strip()
            s = s[m.end():]
            changed = True
            continue
        toks = s.split()
        if toks and toks[0] in _ITEM_STOPWORDS:
            s = " ".join(toks[1:])
            changed = True
            continue
        if toks and toks[-1] in _ITEM_STOPWORDS:
            s = " ".join(toks[:-1])
            changed = True

    s = re.sub(r"\s+", " ", s).strip()
    tokens = {fold_plural(t) for t in s.split()}
    return s, tokens, note


def item_tokens(chunk: str) -> set[str]:
    """Matching token set for a chunk (paraphrase-tolerant normalization)."""
    return normalize_item(chunk)[1]


def items_match(a: set[str], b: set[str]) -> bool:
    """Paraphrase-tolerant match (NoLiMa-informed): token-set overlap >= 0.5
    after stopword removal and plural fold, or containment."""

    if not a or not b:
        return False
    inter = a & b
    if len(inter) / min(len(a), len(b)) >= 0.5:
        return True
    return a <= b or b <= a


def _load_turns(payload: Any) -> tuple[list[dict[str, str]], Any]:
    """Normalize a call-result payload (wrapped dict, bare dict, or list) to
    turns; return (turns, call_id)."""
    call_id = None
    raw = None
    if isinstance(payload, dict):
        call_id = payload.get("call_id")
        result = payload.get("result")
        if isinstance(result, dict):
            if call_id is None:
                call_id = result.get("call_id")
            raw = result.get("transcript")
        if raw is None:
            raw = payload.get("transcript")
    else:
        raw = payload
    if not isinstance(raw, list):
        return [], call_id
    turns = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = item.get("text", item.get("content"))
        if text is None or not str(text).strip():
            continue
        role = str(item.get("role", item.get("speaker", "")))
        turns.append({"role": role, "text": str(text)})
    return turns, call_id


def _sentences(text: str) -> list[str]:
    return [s for s in _SENTENCE_SPLIT_RE.split(text) if s.strip()]


def _raw_chunks(sentence: str) -> list[str]:
    return [c for c in (part.strip() for part in _CHUNK_SPLIT_RE.split(sentence)) if c]


def _withdrawal_target(raw_chunk: str) -> str | None:
    """Return the item name a chunk withdraws, or None if not a negation."""

    s = re.sub(r"[^a-z0-9\s']", " ", raw_chunk.lower())
    s = re.sub(r"\s+", " ", s).strip()
    m = _WITHDRAWAL_RE.match(s)
    return m.group(1).strip() if m else None


def _chunk_items(sentence: str) -> list[tuple[str, set[str], str | None, str]]:
    """Strip leading discourse markers, then normalize each chunk; drop
    chunk-empty items. Returns (display, tokens, note, raw_chunk)."""
    stripped = _LEAD_MARKERS_RE.sub("", sentence).strip()
    items = []
    for chunk in _raw_chunks(stripped):
        display, tokens, note = normalize_item(chunk)
        if tokens:
            items.append((display, tokens, note, chunk))
    return items


def _extends_active_list(sentence: str) -> bool:
    if re.match(r"(?:also|plus|and)\b", sentence, re.IGNORECASE):
        return True
    # A correction ("Actually, two cribs - and drop the late checkout.")
    # edits the existing list rather than starting a new one.
    return bool(_CORRECTION_MARKER_RE.match(sentence))


def analyze_turns(turns: list, call_id: Any = None) -> dict[str, Any]:
    """Extract callee item lists and grade the agent readback."""

    norm_turns: list[tuple[int, str, str]] = []
    for idx, turn in enumerate(turns):
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role", turn.get("speaker", ""))).lower()
        text = _normalize(str(turn.get("text", "")))
        if not text.strip():
            continue
        norm_turns.append((idx, role, text))

    # ---- pass 1: extract callee item lists (with withdrawal semantics)
    lists: list[dict[str, Any]] = []
    withdrawn_tokens: list[set[str]] = []
    for idx, role, text in norm_turns:
        if role not in CALLEE_ROLES:
            continue
        extends = _extends_active_list(text)
        chunk_items = _chunk_items(text)
        if not lists:
            if len(chunk_items) >= 2:
                lists.append({"start_turn_index": idx, "items": []})
            else:
                continue
        elif not extends and len(chunk_items) < 2:
            # Single-chunk sentences without a marker never create a list.
            continue
        elif not extends:
            # A >=2-chunk sentence without a marker STARTS a new list.
            lists.append({"start_turn_index": idx, "items": []})
        target = lists[-1]
        for display, tokens, note, raw in chunk_items:
            wtarget = _withdrawal_target(raw)
            if wtarget is not None:
                # Withdrawal ONLY when the named item is already in the
                # active list; a first-mention negation stays an item.
                wt_tokens = item_tokens(wtarget)
                match_idx = next(
                    (
                        i
                        for i, it in enumerate(target["items"])
                        if items_match(wt_tokens, it["_tokens"])
                    ),
                    None,
                )
                if match_idx is not None:
                    removed = target["items"].pop(match_idx)
                    withdrawn_tokens.append(removed["_tokens"])
                    continue
            if any(tokens == it["_tokens"] for it in target["items"]):
                continue  # dedupe within the same list
            target["items"].append(
                {
                    "item": display,
                    "_tokens": tokens,
                    "stated_turn_index": idx,
                    "note": note,
                }
            )

    all_items = [(lst, it) for lst in lists for it in lst["items"]]

    # ---- pass 2: agent readback detection, capture, added items
    # Capture is generous: any chunk in ANY LATER agent turn (readback or not).
    captured = {id(it): False for _, it in all_items}
    agent_chunks: list[tuple[int, set[str]]] = []
    for idx, role, text in norm_turns:
        if role not in AGENT_ROLES:
            continue
        for sentence in _sentences(text):
            for display, tokens, _note, _raw in _chunk_items(sentence):
                agent_chunks.append((idx, tokens))
    for lst, it in all_items:
        for j, tokens in agent_chunks:
            if j > it["stated_turn_index"] and items_match(tokens, it["_tokens"]):
                captured[id(it)] = True
                break

    readback_seen = False
    added_items: list[dict[str, Any]] = []
    added_keys: set[tuple[str, int]] = set()
    # Items the agent stated in non-readback turns are suggestions, not
    # inventions; re-naming them inside a confirmation is not an add.
    agent_stated: list[tuple[int, set[str]]] = []
    for idx, role, text in norm_turns:
        if role not in AGENT_ROLES:
            continue
        for sentence in _sentences(text):
            chunk_norms = _chunk_items(sentence)
            has_cue = bool(CUE_RE.search(sentence))
            matches_item = any(
                items_match(tokens, it["_tokens"])
                for _, tokens, _note, _raw in chunk_norms
                for _, it in all_items
            )
            is_readback = bool(lists) and ((len(chunk_norms) >= 2) or has_cue) and matches_item
            if is_readback or has_cue:
                readback_seen = True
            if is_readback:
                for display, tokens, _note, raw in chunk_norms:
                    if any(items_match(tokens, it["_tokens"]) for _, it in all_items):
                        continue
                    # An agent restating a withdrawn item - directly
                    # ("late checkout") or as a negation ("no late
                    # checkout") - is not an added item.
                    if any(items_match(tokens, wtok) for wtok in withdrawn_tokens):
                        continue
                    wtarget = _withdrawal_target(raw)
                    if wtarget is not None:
                        wt_tokens = item_tokens(wtarget)
                        if any(items_match(wt_tokens, it["_tokens"]) for _, it in all_items) or any(
                            items_match(wt_tokens, wtok) for wtok in withdrawn_tokens
                        ):
                            continue
                    if any(items_match(tokens, tokens2) for _, tokens2 in agent_stated):
                        continue
                    key = (display, idx)
                    if tokens and key not in added_keys:
                        added_keys.add(key)
                        added_items.append({"item": display, "turn_index": idx})
            else:
                for display, tokens, _note, _raw in chunk_norms:
                    agent_stated.append((idx, tokens))

    dropped = [
        {"item": it["item"], "stated_turn_index": it["stated_turn_index"]}
        for _, it in all_items
        if not captured[id(it)]
    ]

    items_total = len(all_items)
    items_captured = sum(1 for _, it in all_items if captured[id(it)])
    if not lists:
        verdict = "NO_LIST_EXCHANGED"
    elif dropped and added_items:
        verdict = "BOTH_DROPPED_AND_ADDED"
    elif dropped:
        verdict = "ITEMS_DROPPED"
    elif added_items:
        verdict = "ITEMS_ADDED"
    elif readback_seen:
        verdict = "ALL_ITEMS_CAPTURED"
    else:
        verdict = "NO_READBACK_DETECTED"

    review_action = {
        "BOTH_DROPPED_AND_ADDED": REVIEW_ACTION_BOTH,
        "ITEMS_DROPPED": REVIEW_ACTION_DROPPED,
        "ITEMS_ADDED": REVIEW_ACTION_ADDED,
        "ALL_ITEMS_CAPTURED": "none",
        "NO_READBACK_DETECTED": REVIEW_ACTION_NO_READBACK,
        "NO_LIST_EXCHANGED": "none",
    }[verdict]

    def _pub_item(it: dict[str, Any]) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "item": mask_pii(it["item"]),
            "stated_turn_index": it["stated_turn_index"],
            "note": it["note"],
            "captured": captured[id(it)],
        }
        return entry

    return {
        "skill": SKILL_NAME,
        "mode": "analyze",
        "call_id": mask_pii(str(call_id)) if call_id else None,
        "verdict": verdict,
        "lists": [
            {
                "start_turn_index": lst["start_turn_index"],
                "items": [_pub_item(it) for it in lst["items"]],
            }
            for lst in lists
        ],
        "dropped_items": [
            {**d, "item": mask_pii(d["item"])} for d in dropped
        ],
        "added_items": [
            {**a, "item": mask_pii(a["item"])} for a in added_items
        ],
        "counts": {
            "lists_detected": len(lists),
            "items_total": items_total,
            "items_captured": items_captured,
            "items_dropped": len(dropped),
            "items_added": len(added_items),
        },
        "review_action": review_action,
        "notes": mask_pii(DISCLAIMER),
    }


def analyze_payload(payload: Any) -> dict[str, Any]:
    """Analyze a loaded call-result payload (dict with transcript or bare list)."""
    turns, call_id = _load_turns(payload)
    return analyze_turns(turns, call_id=call_id)


CRAFT_PROTOCOL = (
    "Repeat the full list back item by item, in the order the caller gave. "
    "Ask 'Is that everything?' before closing. Never add items the caller did "
    "not state. If an item is unclear, ask a targeted question about that one "
    "item rather than re-asking the whole list. Write the final list into the "
    "summary exactly as confirmed."
)


def craft_goal(number: str, business_name: str = "the business", task: str = "confirm the caller's requests", language: str = "en-US") -> dict[str, Any]:
    """Emit a readback-disciplined goal template for plan_call."""
    return {
        "goal_template": {
            "name": "readback-disciplined business call",
            "description": f"{business_name}: {task} - with readback discipline protocol",
            "language": language,
            "to": number,
            "protocol": CRAFT_PROTOCOL,
            "safety": "Fictional testing only. This template is not an order record or proof of what was promised.",
        }
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog=SKILL_NAME, description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_craft = sub.add_parser("craft", help="Emit a readback-disciplined goal template for plan_call.")
    p_craft.add_argument("--number", required=True, help="E.164 number to call (reserved NANP 555-01XX range, any area code (e.g. +14155550149)).")
    p_craft.add_argument("--business-name", default="the business")
    p_craft.add_argument("--task", default="confirm the caller's requests")
    p_craft.add_argument("--language", default="en-US")
    p_craft.add_argument("--json", action="store_true", help="Print JSON (the default output).")

    p_analyze = sub.add_parser("analyze", help="Audit a CALL-E call result JSON for readback completeness.")
    p_analyze.add_argument("--call-result", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--json", action="store_true", help="Print JSON (the default output).")

    args = parser.parse_args(argv)

    if args.command == "craft":
        if not re.fullmatch(r"\+1[0-9]{3}55501[0-9]{2}", args.number):
            print(
                f"ERROR: --number must be a reserved test number matching "
                f"+1[0-9]{{3}}55501[0-9]{{2}} (e.g. +14155550149), got: {args.number}",
                file=sys.stderr,
            )
            return 2
        payload = craft_goal(
            args.number,
            business_name=args.business_name,
            task=args.task,
            language=args.language,
        )
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    path = Path(args.call_result)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        print(f"ERROR: cannot read call result file: {exc}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON in call result file: {exc}", file=sys.stderr)
        return 2
    if not isinstance(data, (dict, list)):
        print(
            f"ERROR: call result must be a JSON object or array, got {type(data).__name__}",
            file=sys.stderr,
        )
        return 2
    print(json.dumps(analyze_payload(data), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
