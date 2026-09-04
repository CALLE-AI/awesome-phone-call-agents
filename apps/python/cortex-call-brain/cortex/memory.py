"""Cortex two-tier memory — the brain.

Two tiers, one SQLite file:

- **Sub-brain** (`patients`): one row per caller, keyed by E.164 phone. A
  compressed running summary + open items. This is *personal* memory and holds
  PII, so we store summaries (never raw audio) and support forget/expiry.

- **Master brain** (`facts` + `signals`): knowledge shared across everyone.
  `facts` are business knowledge that the brain *learned* from calls; a fact
  stays a ``candidate`` until it is **corroborated** N times (or a human
  approves it), then becomes ``canonical``. This corroboration gate is what
  stops a single caller — mistaken or lying — from poisoning what every future
  call is told. `signals` are anonymized aggregate patterns ("several callers
  on Drug X reported nausea") — never attributed to a person.

Embeddings power similarity (dedup + retrieval). We use Gemini
``text-embedding-004`` when ``GEMINI_API_KEY`` is set, and fall back to a
deterministic local hash embedding so the module still runs offline for dev and
tests. Vectors are tagged with the embedder that produced them and only compared
within the same tag.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

_EMBED_MODEL = os.environ.get("CORTEX_EMBED_MODEL", "gemini-embedding-001")
_FALLBACK_DIM = 256


def _now() -> float:
    return time.time()


def _hash_phone(phone: str, secret: str = "") -> str:
    """Stable id for attributing corroboration without storing the raw number on
    a shared (master-brain) fact. With a `secret` it is a keyed HMAC — a phone
    number is a tiny, enumerable keyspace, so a *bare* hash is brute-forceable;
    the HMAC key (held out of reach of anyone with only the DB rows / rendered
    graph) is what makes the source ids genuinely non-reversible."""
    p = (phone or "").strip().encode()
    if secret:
        return hmac.new(secret.encode(), p, hashlib.sha256).hexdigest()[:16]
    return hashlib.sha256(p).hexdigest()[:16]


class Embedder:
    """Pluggable text embedder. Gemini if a key is present, else a local hash."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self._client = None
        if self.api_key:
            try:
                from google import genai

                self._client = genai.Client(api_key=self.api_key)
                self.tag = f"gemini:{_EMBED_MODEL}"
            except Exception:
                self._client = None
        if self._client is None:
            self.tag = f"hash:{_FALLBACK_DIM}"

    def embed(self, text: str) -> np.ndarray:
        text = (text or "").strip()
        if self._client is not None:
            try:
                r = self._client.models.embed_content(model=_EMBED_MODEL, contents=text)
                vec = np.array(r.embeddings[0].values, dtype=np.float32)
                return _normalize(vec)
            except Exception:
                # Fall through to local embedding rather than crash a campaign.
                pass
        return _hash_embed(text)


def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n else v


def _hash_embed(text: str) -> np.ndarray:
    """Deterministic bag-of-char-trigrams embedding — crude but offline & stable."""
    vec = np.zeros(_FALLBACK_DIM, dtype=np.float32)
    t = f"  {text.lower()} "
    for i in range(len(t) - 2):
        # Not security-sensitive: md5 here is only a fast bucketer for the offline
        # embedding fallback, never used to protect anything.
        h = int(hashlib.md5(t[i : i + 3].encode(), usedforsecurity=False).hexdigest(), 16)
        vec[h % _FALLBACK_DIM] += 1.0
    return _normalize(vec)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))  # both are pre-normalized


@dataclass
class Patient:
    phone: str
    name: Optional[str]
    consent: bool
    language: Optional[str]
    summary: str
    open_items: list
    last_call_ts: Optional[float]
    callback_reason: Optional[str] = None   # e.g. "at a wedding" — what to open the next call with
    callback_ts: Optional[float] = None


class Memory:
    def __init__(self, db_path: str = "cortex.db", embedder: Optional[Embedder] = None,
                 promotion_min: Optional[int] = None):
        self.db = sqlite3.connect(db_path)
        self.db.row_factory = sqlite3.Row
        self.embedder = embedder or Embedder()
        self.promotion_min = int(
            promotion_min if promotion_min is not None
            else os.environ.get("CORTEX_FACT_PROMOTION_MIN", 2)
        )
        # a symptom seen by >= alert_min DISTINCT callers is surfaced to the admin;
        # seen by >= auto_min it auto-changes the prompt (when policy is 'auto').
        self.signal_alert_min = int(os.environ.get("CORTEX_SIGNAL_ALERT_MIN", 2))
        self.signal_auto_min = int(os.environ.get("CORTEX_SIGNAL_AUTO_APPROVE_MIN", 4))
        self._init_schema()
        # Keyed-HMAC secret for source ids. Prefer an env secret (kept outside the
        # DB); otherwise persist a random one per-DB so corroboration is stable
        # across runs and graph node ids can't be reversed by anyone without it.
        self._hash_secret = os.environ.get("CORTEX_HASH_SECRET") or self._get_or_make_secret()

    def _get_or_make_secret(self) -> str:
        s = self.get_setting("hash_secret")
        if not s:
            s = secrets.token_hex(16)
            self.set_setting("hash_secret", s)
        return s

    def source_id(self, phone: str) -> str:
        """Non-reversible, per-DB-stable id for a caller (keyed HMAC of the number)."""
        return _hash_phone(phone, self._hash_secret)

    def _init_schema(self) -> None:
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS patients (
                phone TEXT PRIMARY KEY,
                name TEXT,
                consent INTEGER DEFAULT 0,
                language TEXT,
                summary TEXT DEFAULT '',
                open_items TEXT DEFAULT '[]',
                last_call_ts REAL,
                updated_at REAL
            );
            CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                embedding TEXT NOT NULL,
                embedder TEXT NOT NULL,
                status TEXT DEFAULT 'candidate',      -- candidate | canonical
                corroborations INTEGER DEFAULT 1,
                sources TEXT DEFAULT '[]',             -- list of hashed phones
                created_at REAL,
                updated_at REAL
            );
            CREATE TABLE IF NOT EXISTS signals (
                key TEXT PRIMARY KEY,                  -- e.g. "drug:X|symptom:nausea"
                description TEXT,
                count INTEGER DEFAULT 0,
                updated_at REAL
            );
            CREATE TABLE IF NOT EXISTS calls (
                run_id TEXT PRIMARY KEY,
                recovery_id TEXT,
                phone TEXT,
                outcome TEXT,
                summary TEXT,
                transcript TEXT,
                cost_usd REAL,
                ts REAL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            """
        )
        # migration: signals gained an admin-approval lifecycle after v1.
        cols = {r["name"] for r in self.db.execute("PRAGMA table_info(signals)")}
        for name, ddl in (("approved", "approved INTEGER DEFAULT 0"),
                          ("dismissed", "dismissed INTEGER DEFAULT 0"),
                          ("approved_by", "approved_by TEXT"),
                          ("approved_at", "approved_at REAL"),
                          ("sources", "sources TEXT DEFAULT '[]'")):
            if name not in cols:
                self.db.execute(f"ALTER TABLE signals ADD COLUMN {ddl}")
        # migration: patients gained callback continuity after v1.
        pcols = {r["name"] for r in self.db.execute("PRAGMA table_info(patients)")}
        for name, ddl in (("callback_reason", "callback_reason TEXT"),
                          ("callback_ts", "callback_ts REAL")):
            if name not in pcols:
                self.db.execute(f"ALTER TABLE patients ADD COLUMN {ddl}")
        self.db.commit()

    # ---- sub-brain (per caller) -------------------------------------------
    def upsert_patient(self, phone: str, *, name: str = None, consent: bool = None,
                       language: str = None, summary: str = None,
                       open_items: list = None) -> None:
        cur = self.get_patient(phone)
        row = {
            "name": name if name is not None else (cur.name if cur else None),
            "consent": int(consent if consent is not None else (cur.consent if cur else 0)),
            "language": language if language is not None else (cur.language if cur else None),
            "summary": summary if summary is not None else (cur.summary if cur else ""),
            "open_items": json.dumps(open_items if open_items is not None
                                     else (cur.open_items if cur else [])),
        }
        self.db.execute(
            """INSERT INTO patients (phone,name,consent,language,summary,open_items,updated_at)
               VALUES (:phone,:name,:consent,:language,:summary,:open_items,:ts)
               ON CONFLICT(phone) DO UPDATE SET
                 name=:name, consent=:consent, language=:language,
                 summary=:summary, open_items=:open_items, updated_at=:ts""",
            {"phone": phone, **row, "ts": _now()},
        )
        self.db.commit()

    def get_patient(self, phone: str) -> Optional[Patient]:
        r = self.db.execute("SELECT * FROM patients WHERE phone=?", (phone,)).fetchone()
        if not r:
            return None
        keys = r.keys()
        return Patient(
            phone=r["phone"], name=r["name"], consent=bool(r["consent"]),
            language=r["language"], summary=r["summary"] or "",
            open_items=json.loads(r["open_items"] or "[]"),
            last_call_ts=r["last_call_ts"],
            callback_reason=(r["callback_reason"] if "callback_reason" in keys else None),
            callback_ts=(r["callback_ts"] if "callback_ts" in keys else None),
        )

    def set_callback(self, phone: str, reason: str) -> None:
        """Remember that the caller asked us to try again later, and why — so the
        next call can open by referencing it ('last time you were at a wedding…').

        `reason` is LLM-extracted from what the caller said, so it is untrusted
        text that later lands in a call goal. Clamp and flatten it (single line,
        short) so it can't smuggle instructions into the next prompt."""
        # first clause only (drop anything after a sentence break), flattened + clamped
        import re as _re
        r = _re.split(r"[.\n;:!?]", reason or "")[0]
        r = " ".join(r.split())[:40].strip() or None
        self.db.execute("UPDATE patients SET callback_reason=?, callback_ts=? WHERE phone=?",
                        (r, _now(), phone))
        self.db.commit()

    def clear_callback(self, phone: str) -> None:
        """The caller engaged this time — the pending callback is resolved."""
        self.db.execute("UPDATE patients SET callback_reason=NULL, callback_ts=NULL WHERE phone=?",
                        (phone,))
        self.db.commit()

    def forget_patient(self, phone: str) -> None:
        """Right-to-forget: erase ALL personal data for a caller — the sub-brain
        AND their call-log rows (which hold the raw number, summary, and full
        transcript). Canonical/anonymized master-brain knowledge is unaffected
        (it holds no attributable PII — only hashed sources)."""
        self.db.execute("DELETE FROM patients WHERE phone=?", (phone,))
        self.db.execute("DELETE FROM calls WHERE phone=?", (phone,))
        self.db.commit()

    # ---- master brain: facts (with the corroboration gate) -----------------
    def _default_sim_threshold(self) -> float:
        # Gemini embeddings cluster near-synonyms tightly (~0.86 is a good
        # "same fact" cut); the offline hash fallback has a flatter distribution
        # and needs a lower bar. Semantic corroboration is only meaningful with
        # Gemini — the hash mode mainly de-dupes near-identical text.
        return 0.55 if self.embedder.tag.startswith("hash:") else 0.86

    def add_candidate_fact(self, text: str, source_phone: str,
                           sim_threshold: float = None) -> dict:
        """Record a fact learned on a call. If it matches an existing fact, count
        it as corroboration (from a *distinct* source) and maybe promote it to
        canonical. Returns {status, id, corroborations}."""
        if sim_threshold is None:
            sim_threshold = self._default_sim_threshold()
        emb = self.embedder.embed(text)
        src = self.source_id(source_phone)
        best = self._most_similar_fact(emb)
        if best and best["sim"] >= sim_threshold:
            sources = set(json.loads(best["sources"] or "[]"))
            if src not in sources:  # same person repeating itself is NOT corroboration
                sources.add(src)
                corr = best["corroborations"] + 1
                status = "canonical" if corr >= self.promotion_min else best["status"]
                self.db.execute(
                    "UPDATE facts SET corroborations=?, sources=?, status=?, updated_at=? WHERE id=?",
                    (corr, json.dumps(sorted(sources)), status, _now(), best["id"]),
                )
                self.db.commit()
                return {"status": status, "id": best["id"], "corroborations": corr}
            return {"status": best["status"], "id": best["id"],
                    "corroborations": best["corroborations"]}
        cur = self.db.execute(
            """INSERT INTO facts (text,embedding,embedder,status,corroborations,sources,created_at,updated_at)
               VALUES (?,?,?,'candidate',1,?,?,?)""",
            (text, json.dumps(emb.tolist()), self.embedder.tag,
             json.dumps([src]), _now(), _now()),
        )
        self.db.commit()
        return {"status": "candidate", "id": cur.lastrowid, "corroborations": 1}

    def approve_fact(self, fact_id: int) -> None:
        """Human override: promote a candidate straight to canonical."""
        self.db.execute("UPDATE facts SET status='canonical', updated_at=? WHERE id=?",
                        (_now(), fact_id))
        self.db.commit()

    def _most_similar_fact(self, emb: np.ndarray) -> Optional[dict]:
        best = None
        for r in self.db.execute(
            "SELECT * FROM facts WHERE embedder=?", (self.embedder.tag,)
        ):
            v = np.array(json.loads(r["embedding"]), dtype=np.float32)
            sim = _cosine(emb, v)
            if best is None or sim > best["sim"]:
                best = {**dict(r), "sim": sim}
        return best

    def search_canonical_facts(self, query: str, k: int = 5,
                               min_sim: float = 0.35) -> list[dict]:
        """Retrieve the canonical knowledge relevant to a query, for injecting
        into the next call's context."""
        emb = self.embedder.embed(query)
        scored = []
        for r in self.db.execute(
            "SELECT * FROM facts WHERE status='canonical' AND embedder=?", (self.embedder.tag,)
        ):
            v = np.array(json.loads(r["embedding"]), dtype=np.float32)
            sim = _cosine(emb, v)
            if sim >= min_sim:
                scored.append({"text": r["text"], "sim": sim,
                               "corroborations": r["corroborations"]})
        scored.sort(key=lambda x: x["sim"], reverse=True)
        return scored[:k]

    # ---- settings (admin policy) -------------------------------------------
    def get_setting(self, key: str, default: str = None) -> Optional[str]:
        r = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return r["value"] if r else default

    def set_setting(self, key: str, value: str) -> None:
        self.db.execute(
            "INSERT INTO settings (key,value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=?", (key, value, value))
        self.db.commit()

    def directive_policy(self) -> str:
        """'auto' = strong signals change the prompt on their own; 'manual' =
        every prompt change needs an admin click, no matter how many callers."""
        return self.get_setting("directive_policy", "auto")

    # ---- master brain: anonymized aggregate signals ------------------------
    def bump_signal(self, key: str, description: str, source_phone: str = None) -> int:
        """Count a signal by DISTINCT callers, exactly like the facts gate — the
        same caller reporting a symptom repeatedly does not inflate it, so no
        single caller can push a directive to the auto-approve threshold. `count`
        is the number of distinct hashed sources."""
        r = self.db.execute("SELECT count, sources, dismissed FROM signals WHERE key=?",
                            (key,)).fetchone()
        sources = set(json.loads(r["sources"]) if (r and r["sources"]) else [])
        if source_phone:
            sources.add(self.source_id(source_phone))
            count = len(sources)
        else:  # no attributable source: fall back to a raw increment
            count = (r["count"] if r else 0) + 1
        src_json = json.dumps(sorted(sources))
        self.db.execute(
            """INSERT INTO signals (key,description,count,sources,updated_at) VALUES (?,?,?,?,?)
               ON CONFLICT(key) DO UPDATE SET count=?, description=?, sources=?, updated_at=?""",
            (key, description, count, src_json, _now(), count, description, src_json, _now()),
        )
        self.db.commit()
        # AUTO policy: a symptom reported by enough DISTINCT callers changes the
        # prompt on its own — unless the admin already dismissed it.
        already_dismissed = bool(r["dismissed"]) if r else False
        if (self.directive_policy() == "auto" and count >= self.signal_auto_min
                and not already_dismissed):
            self.approve_signal(key, by="auto")
        return count

    def signals(self, min_count: int = 2) -> list[dict]:
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM signals WHERE count>=? ORDER BY count DESC", (min_count,))]

    # ---- directive lifecycle: proposed -> approved prompt changes -----------
    def pending_directives(self) -> list[dict]:
        """Corroborated patterns awaiting an admin decision (>= alert_min,
        not yet approved or dismissed)."""
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM signals WHERE count>=? AND COALESCE(approved,0)=0 "
            "AND COALESCE(dismissed,0)=0 ORDER BY count DESC", (self.signal_alert_min,))]

    def approved_directives(self) -> list[dict]:
        """Patterns the agent is cleared to proactively ask about."""
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM signals WHERE COALESCE(approved,0)=1 ORDER BY count DESC")]

    def approve_signal(self, key: str, by: str = "admin") -> None:
        self.db.execute(
            "UPDATE signals SET approved=1, dismissed=0, approved_by=?, approved_at=? "
            "WHERE key=?", (by, _now(), key))
        self.db.commit()

    def dismiss_signal(self, key: str) -> None:
        """Admin says 'don't ask about this'. Stays dismissed even if more
        callers report it (won't auto-approve) until explicitly re-approved."""
        self.db.execute(
            "UPDATE signals SET dismissed=1, approved=0, approved_by=NULL WHERE key=?", (key,))
        self.db.commit()

    def revoke_signal(self, key: str) -> None:
        """Pull an approved directive back out of the call script."""
        self.db.execute(
            "UPDATE signals SET approved=0, approved_by=NULL WHERE key=?", (key,))
        self.db.commit()

    # ---- call log ----------------------------------------------------------
    def record_call(self, run_id: str, phone: str, *, recovery_id: str = None,
                    outcome: str = None, summary: str = None, transcript: str = None,
                    cost_usd: float = None) -> None:
        self.db.execute(
            """INSERT INTO calls (run_id,recovery_id,phone,outcome,summary,transcript,cost_usd,ts)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(run_id) DO UPDATE SET
                 phone=COALESCE(?,phone), outcome=COALESCE(?,outcome),
                 summary=COALESCE(?,summary), transcript=COALESCE(?,transcript),
                 cost_usd=COALESCE(?,cost_usd)""",
            (run_id, recovery_id, phone, outcome, summary, transcript, cost_usd, _now(),
             phone, outcome, summary, transcript, cost_usd),
        )
        self.db.commit()
        if phone:
            self.db.execute("UPDATE patients SET last_call_ts=? WHERE phone=?", (_now(), phone))
            self.db.commit()

    def total_spend(self) -> float:
        r = self.db.execute("SELECT COALESCE(SUM(cost_usd),0) s FROM calls").fetchone()
        return float(r["s"] or 0.0)


if __name__ == "__main__":
    # Smoke test of the corroboration gate. Runs offline (hash embeddings), so we
    # use near-identical text; real semantic corroboration ("nausea" == "sick to
    # the stomach") needs a Gemini key. Expected: candidate -> same-source is
    # ignored -> a distinct source promotes it to canonical.
    m = Memory(db_path=":memory:", promotion_min=2)
    print("embedder:", m.embedder.tag)
    print("A (patient 1):        ", m.add_candidate_fact("Drug X causes nausea", "+12025550110"))
    print("A again (same source): ", m.add_candidate_fact("Drug X causes nausea", "+12025550110"))
    print("B (patient 2 -> promote):", m.add_candidate_fact("Drug X causes nausea", "+12025550120"))
    print("canonical search:     ", m.search_canonical_facts("Drug X causes nausea"))
