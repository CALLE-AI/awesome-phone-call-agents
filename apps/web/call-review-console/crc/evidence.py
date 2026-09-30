"""Does the transcript support the structured result? Two layers:
1. deterministic: literal/numeric/enum overlap between each result field and the transcript text
2. optional LLM (Gemini via google-genai) that cites the supporting turn for each field, or says none

A field with no support is an *unsupported claim* — the thing a reviewer must catch before acting."""
from __future__ import annotations

import json
import os
import re
from typing import Any


def _flatten(obj: Any, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(_flatten(v, f"{prefix}.{k}" if prefix else k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.update(_flatten(v, f"{prefix}[{i}]"))
    else:
        out[prefix] = obj
    return out


ENUMISH = {"yes", "no", "true", "false", "unknown", "none", "n/a", "na", "maybe", "ok"}


def _normalize(text: str) -> str:
    """Lower-case and fold the spoken forms of times so '9 a.m.' matches a reported '9am'."""
    t = text.lower()
    t = re.sub(r"\b(\d{1,2}(?::\d{2})?)\s*([ap])\.?\s*m\.?\b", r"\1\2m", t)
    t = re.sub(r"\b([ap])\.m\.", r"\1m", t)
    return t


def deterministic(result: dict | None, turns: list[dict]) -> list[dict]:
    text = _normalize(" ".join(str(t.get("text") or "") for t in turns))
    rows = []
    for path, val in _flatten(result or {}).items():
        if val is None or val == "":
            rows.append({"field": path, "value": val, "supported": None, "how": "empty"})
            continue
        sval = _normalize(str(val).strip())
        found = False
        how = "not found"
        if isinstance(val, str) and sval in ENUMISH:
            # 'yes'/'no'/'unknown' appear in almost every transcript; a literal hit proves nothing
            rows.append({"field": path, "value": val, "supported": None, "how": "enum — needs reading"})
            continue
        if isinstance(val, bool):
            # booleans cannot be matched literally; leave to the LLM layer
            rows.append({"field": path, "value": val, "supported": None, "how": "boolean — needs reading"})
            continue
        if isinstance(val, (int, float)):
            nums = {n.replace(",", "") for n in re.findall(r"\d[\d,]*\.?\d*", text)}
            found = str(val).rstrip("0").rstrip(".") in {n.rstrip("0").rstrip(".") for n in nums} or str(val) in nums
            how = "number spoken" if found else "number not spoken"
        else:
            tokens = [w for w in re.findall(r"[a-z0-9]+", sval) if len(w) > 2]
            if tokens:
                hit = sum(1 for w in tokens if w in text)
                found = hit / len(tokens) >= 0.6
                how = f"{hit}/{len(tokens)} value tokens in transcript"
            else:
                how = "value too short to match"
        rows.append({"field": path, "value": val, "supported": found, "how": how})
    return rows


def llm(result: dict | None, turns: list[dict], task: str) -> list[dict] | None:
    """Optional: only when GOOGLE_API_KEY or Vertex settings exist. Returns per-field support with cited turns."""
    if not result:
        return []
    try:
        from google import genai
        from google.genai import types
    except Exception:
        return None
    use_vertex = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true"
    if not use_vertex and not os.getenv("GOOGLE_API_KEY"):
        return None
    client = genai.Client(vertexai=True, project=os.getenv("GOOGLE_CLOUD_PROJECT"), location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")) if use_vertex else genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
    transcript = "\n".join(f"[{i}] {t.get('offset_seconds', 0)}s {t.get('speaker')}: {t.get('text')}" for i, t in enumerate(turns))
    prompt = f"""You are auditing a phone call made by an AI agent. Task given to the agent: {task}
Structured result the agent reported:
{json.dumps(result, indent=1)}
Transcript (turn index, offset, speaker, text):
{transcript}

For EVERY leaf field of the structured result, decide whether the transcript supports the reported value. Cite the supporting
turn indexes. If nothing in the transcript supports it, say supported=false. Answer as JSON: {{"fields": [{{"field": "...", "supported": true|false, "turns": [..], "note": "..."}}]}}"""
    try:
        res = client.models.generate_content(model=os.getenv("CRC_MODEL", "gemini-2.5-flash"), contents=prompt, config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0))
        return json.loads(res.text or "{}").get("fields", [])
    except Exception:
        return None
