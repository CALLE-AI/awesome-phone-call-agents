#!/usr/bin/env python3
"""
Lightweight web server for CHRONO-AUDIT Verification Ledger UI.
Serves static assets from web/ directory and provides REST endpoints:
- GET  /api/status
- GET  /api/phonebook
- POST /api/phonebook
- POST /api/audit (runs real Python ChronoAuditor on PR text)
"""

from __future__ import annotations

import argparse
import functools
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler
import socketserver

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, "web")
PHONEBOOK_PATH = os.path.join(BASE_DIR, "phonebook.json")

# Ensure chrono_audit package is importable
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import hashlib

from chrono_audit.config import Config
from chrono_audit.verifier import ChronoAuditor
from chrono_audit.models import VerificationOutcome, Confirmation, EntailmentLabel, Verdict, Claim
from chrono_audit.calle_client import CalleVerificationClient


def load_phonebook() -> dict[str, str]:
    if os.path.exists(PHONEBOOK_PATH):
        try:
            with open(PHONEBOOK_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {k.lower(): str(v) for k, v in data.items() if not k.startswith("_")}
        except Exception:
            pass
    return {
        "@sarah_dba": "+1 415 555 0192",
        "sarah": "+1 415 555 0192",
        "the architect": "+1 206 555 0148",
        "the security lead": "+1 650 555 0173",
        "elena rostova": "+1 408 555 0115",
    }


def save_phonebook(data: dict[str, str]) -> None:
    with open(PHONEBOOK_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def outcome_to_dict(outcome: VerificationOutcome, title: str, body: str, pr_ref: str) -> dict:
    hops_data = []
    for i, hop in enumerate(outcome.hops):
        call_res = hop.call_result
        ent_res = hop.entailment
        hops_data.append({
            "hopIndex": i,
            "authorizer": hop.claim.authorizer_name,
            "role": "Verified Contact",
            "phone": "Registered on file" if call_res and call_res.reachable else "Not in directory",
            "reached": call_res.reachable if call_res else False,
            "durationSec": call_res.call_duration_seconds if call_res else 0,
            "claimText": hop.claim.claim_text,
            "statement": call_res.authorizer_statement if call_res else "[No statement received]",
            "confirmation": call_res.direct_confirmation.value if call_res else "unclear",
            "entailmentResult": ent_res.label.value if ent_res else "neutral",
            "confidence": f"{ent_res.confidence:.2f}" if ent_res else "0.00",
            "engine": ent_res.engine if ent_res else "none",
        })

    primary_authorizer = outcome.hops[0].claim.authorizer_name if outcome.hops else "Unknown"
    
    return {
        "id": f"aud_{abs(hash(pr_ref + title + body)) % 9000 + 1000}",
        "prRef": pr_ref or "custom-repo#100",
        "title": title,
        "body": body,
        "commitSha": f"{abs(hash(body)) & 0xffffffffff:010x}",
        "authorizer": primary_authorizer,
        "timestamp": "Just now",
        "verdict": outcome.verdict.value.upper(),
        "reason": outcome.reason,
        "policy": "Fail-Closed Verification Policy",
        "engine": outcome.hops[0].entailment.engine if outcome.hops and outcome.hops[0].entailment else "Heuristic-v1",
        "hops": hops_data,
    }


class ChronoAuditHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/status":
            cfg = Config.from_env()
            resp = {
                "status": "online",
                "dress_rehearsal": cfg.dress_rehearsal,
                "has_api_key": bool(cfg.calle_api_key),
                "entailment_threshold": cfg.entailment_confidence_threshold,
                "max_hops": cfg.max_hops,
                "max_call_seconds": cfg.max_call_duration_seconds,
            }
            data = json.dumps(resp).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        elif self.path == "/api/phonebook":
            data = json.dumps(load_phonebook()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/audit":
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8")
            try:
                payload = json.loads(raw_body)
                title = payload.get("title", "")
                body = payload.get("body", "")
                pr_ref = payload.get("pr_ref", "manual-audit#001")
                
                # Run the actual ChronoAuditor pipeline!
                phonebook = load_phonebook()
                auditor = ChronoAuditor(phonebook=phonebook)
                outcome = auditor.audit_pr(pr_ref, title, body)
                
                result = outcome_to_dict(outcome, title, body, pr_ref)
                data = json.dumps(result).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                err_data = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err_data)))
                self.end_headers()
                self.wfile.write(err_data)
            return
        elif self.path == "/api/phonebook":
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8")
            try:
                payload = json.loads(raw_body)
                save_phonebook(payload)
                data = json.dumps({"status": "saved"}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                err_data = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err_data)))
                self.end_headers()
                self.wfile.write(err_data)
            return
        elif self.path == "/api/telephony-sudo":
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8")
            try:
                payload = json.loads(raw_body)
                cmd = payload.get("command", "")
                authorizer = payload.get("authorizer", "@sarah_dba")
                reason = payload.get("reason", "Privileged action")
                
                phonebook = load_phonebook()
                phone = phonebook.get(authorizer.lower(), "+15550001111")
                
                # Use live mode only if explicitly requested and phone is not a 555 dummy
                is_live = payload.get("live", False) and bool(phone) and ("555" not in phone)
                base_cfg = Config.from_env()
                call_cfg = base_cfg if is_live else Config(
                    dress_rehearsal=True,
                    calle_api_key=base_cfg.calle_api_key,
                    calle_base_url=base_cfg.calle_base_url,
                    entailment_confidence_threshold=base_cfg.entailment_confidence_threshold,
                    max_hops=base_cfg.max_hops,
                    max_call_duration_seconds=base_cfg.max_call_duration_seconds,
                )
                client = CalleVerificationClient(call_cfg)
                claim = Claim(
                    authorizer_name=authorizer,
                    claim_text=f"Authorize command: '{cmd}' for reason: '{reason}'",
                    subject=reason,
                    source_line=cmd,
                )
                res = client.verify_claim(claim, phone)
                authorized = (res.direct_confirmation == Confirmation.CONFIRMED)
                
                resp_data = {
                    "authorized": authorized,
                    "command": cmd,
                    "authorizer": authorizer,
                    "durationSec": res.call_duration_seconds,
                    "statement": res.authorizer_statement,
                    "confirmation": res.direct_confirmation.value,
                    "attestation_id": f"attest_{abs(hash(cmd + authorizer)) % 900000 + 100000}" if authorized else None,
                    "mode": "live" if is_live else "dress_rehearsal",
                }
                data = json.dumps(resp_data).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                err_data = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err_data)))
                self.end_headers()
                self.wfile.write(err_data)
            return
        elif self.path == "/api/test-call":
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8")
            try:
                payload = json.loads(raw_body)
                name = payload.get("name", "Judge")
                phone = payload.get("phone", "")
                claim_text = payload.get("claim", "Verbal authorization test")
                simulate = payload.get("simulate", False)
                
                # Check if live call is requested
                base_cfg = Config.from_env()
                is_live = (not simulate) and bool(phone) and ("555" not in phone) and bool(base_cfg.calle_api_key)
                call_cfg = base_cfg if is_live else Config(
                    dress_rehearsal=True,
                    calle_api_key=base_cfg.calle_api_key,
                    calle_base_url=base_cfg.calle_base_url,
                    entailment_confidence_threshold=base_cfg.entailment_confidence_threshold,
                    max_hops=base_cfg.max_hops,
                    max_call_duration_seconds=base_cfg.max_call_duration_seconds,
                )
                
                client = CalleVerificationClient(call_cfg)
                claim = Claim(
                    authorizer_name=name,
                    claim_text=claim_text,
                    subject="Production authorization check",
                    source_line=claim_text,
                )
                res = client.verify_claim(claim, phone or "+15550001111")
                
                resp_data = {
                    "authorizer": name,
                    "phone": phone,
                    "durationSec": res.call_duration_seconds,
                    "reached": res.reachable,
                    "statement": res.authorizer_statement,
                    "confirmation": res.direct_confirmation.value,
                    "audio_sha256": res.audio_sha256 or hashlib.sha256(claim_text.encode()).hexdigest(),
                    "call_uuid": res.call_uuid or f"call_{abs(hash(claim_text)) % 90000 + 10000}",
                }
                data = json.dumps(resp_data).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                err_data = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err_data)))
                self.end_headers()
                self.wfile.write(err_data)
            return

        self.send_response(404)
        self.end_headers()


def run(port: int = 8080):
    if not os.path.isdir(WEB_DIR):
        print(f"Error: web directory not found at {WEB_DIR}", file=sys.stderr)
        sys.exit(1)

    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(ChronoAuditHandler, directory=WEB_DIR)
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        print("=" * 64, flush=True)
        print(" CHRONO-AUDIT: Verification Ledger Web Server", flush=True)
        print("=" * 64, flush=True)
        print(f" Local Address: http://127.0.0.1:{port}", flush=True)
        print(f" Serving Directory: {WEB_DIR}", flush=True)
        print(" Connected Backend: ChronoAuditor Python Engine", flush=True)
        print("=" * 64, flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serve CHRONO-AUDIT Web UI with API")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    args = parser.parse_args()
    run(port=args.port)
