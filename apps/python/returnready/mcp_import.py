"""Import a finished CALL-E MCP result without dialing or trusting its success flag.

This is an operator-mediated result adapter, not authentication or a live client.
Blocked imports retain a metadata receipt, not the transcript or extracted claims.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_BYTES = 180_000
IDENT = re.compile(r'[A-Za-z0-9_-]{1,120}')
LINE = re.compile(r'^\[(\d{2}):(\d{2}):(\d{2})\] (BOT|USER): ?(.*)$')
REFUSAL = re.compile(r"\b(?:not able to grant permissions?|cannot grant permissions?|can't grant permissions?|do not record|don't record|do not consent|don't consent|stop (?:the )?(?:call|recording)|cannot help further|can't help further)\b", re.I)
TERMINAL = {'COMPLETED', 'FAILED', 'CANCELLED', 'CANCELED'}
CONSENTS = {'unknown', 'not_granted', 'granted'}


def require(ok: bool, message: str) -> None:
    if not ok:
        raise ValueError(message)


def encoded(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def fingerprint(obj: Any) -> str:
    return hashlib.sha256(encoded(obj)).hexdigest()


def timestamp(value: Any) -> datetime:
    require(isinstance(value, str), 'Supply the original observation timestamp.')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('Observation time must be timezone-qualified ISO text.') from exc
    require(parsed.tzinfo is not None, 'Observation time needs a timezone.')
    return parsed.astimezone(timezone.utc)


def string(value: Any, label: str, maximum: int) -> str:
    require(isinstance(value, str) and 0 < len(value.strip()) <= maximum, f'Invalid {label}.')
    require(not any(ord(c) < 32 and c not in '\n\t' for c in value), f'Invalid {label} characters.')
    return value.strip()


def parse_transcript(value: Any) -> list[dict]:
    """Only the timestamped BOT/USER format actually observed from get_call_run."""
    require(isinstance(value, str) and len(value.encode()) <= MAX_BYTES, 'Invalid MCP transcript.')
    turns: list[dict] = []
    previous = -1
    for line in value.splitlines():
        if not line.strip():
            continue
        match = LINE.fullmatch(line)
        require(match is not None, 'Unsupported transcript format; preserve the original and review manually.')
        h, m, s = map(int, match.group(1, 2, 3))
        require(m < 60 and s < 60, 'Invalid transcript timestamp.')
        offset = 3600*h + 60*m + s
        require(offset >= previous, 'Transcript timestamps are out of order.')
        previous = offset
        speech = match.group(5)
        require(0 < len(speech) <= 6000, 'Empty or oversized transcript turn.')
        turns.append({'speaker': 'bot' if match.group(4) == 'BOT' else 'user',
                      'offset_seconds': offset, 'text': speech})
    require(len(turns) <= 500, 'Too many transcript turns.')
    return turns


def validate_receipt(raw: Any) -> dict:
    """Rechecked on every normal inspect/save/reopen; a receipt is not a signature."""
    keys = {'format', 'version', 'run_id', 'call_id', 'provider_status',
            'provider_task_completed', 'observed_at', 'input_sha256', 'consent',
            'provider_reported_blocked', 'provider_error_reported', 'recipient_refusal_detected',
            'transcript_withheld', 'processing_permitted', 'blocked_reasons',
            'automatic_retry', 'provenance'}
    require(isinstance(raw, dict) and set(raw) == keys, 'Invalid MCP receipt fields.')
    require(raw['format'] == 'returnready-mcp-receipt' and type(raw['version']) is int and raw['version'] == 1, 'Unsupported MCP receipt.')
    require(isinstance(raw['run_id'], str) and IDENT.fullmatch(raw['run_id']) is not None, 'Invalid MCP run ID.')
    require(raw['call_id'] is None or isinstance(raw['call_id'], str) and IDENT.fullmatch(raw['call_id']) is not None, 'Invalid provider call ID.')
    require(raw['provider_status'] in TERMINAL, 'MCP run is not terminal.')
    require(raw['provider_task_completed'] is None or type(raw['provider_task_completed']) is bool, 'Invalid provider task flag.')
    timestamp(raw['observed_at'])
    require(isinstance(raw['input_sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', raw['input_sha256']) is not None, 'Invalid input fingerprint.')
    consent = raw['consent']
    require(isinstance(consent, dict) and set(consent) == {'state', 'basis'}, 'Invalid consent review.')
    require(isinstance(consent['state'], str) and consent['state'] in CONSENTS, 'Invalid consent state.')
    string(consent['basis'], 'consent basis', 500)
    for key in ('provider_reported_blocked', 'provider_error_reported', 'recipient_refusal_detected', 'transcript_withheld', 'processing_permitted', 'automatic_retry'):
        require(type(raw[key]) is bool, 'MCP receipt booleans must be explicit.')
    require(raw['automatic_retry'] is False, 'MCP import cannot request a retry.')
    reasons = blocked_reasons(raw)
    require(raw['blocked_reasons'] == reasons, 'MCP receipt reasons no longer agree with its inputs.')
    permitted = not reasons
    require(raw['processing_permitted'] is permitted and raw['transcript_withheld'] is not permitted, 'MCP receipt contradicts consent or outcome.')
    require(raw['provenance'] == 'operator-supplied MCP result; not independently authenticated', 'Invalid provenance notice.')
    return copy.deepcopy(raw)


def blocked_reasons(receipt: dict) -> list[str]:
    reasons = []
    if receipt['consent']['state'] != 'granted':
        reasons.append('Recorded/transcribed enquiry permission was not established.')
    if receipt['provider_status'] != 'COMPLETED':
        reasons.append('The provider run did not complete normally.')
    if receipt['provider_task_completed'] is not True:
        reasons.append('The provider did not report task completion.')
    if receipt['provider_error_reported']:
        reasons.append('The provider returned an explicit error.')
    if receipt['provider_reported_blocked']:
        reasons.append('The provider itself reported a blocked outcome.')
    if receipt['recipient_refusal_detected']:
        reasons.append('Recipient wording contains an explicit refusal or stop phrase; manual resolution is required.')
    return reasons


def adapt(raw: Any, *, expected_run_id: str, observed_at: str, consent: dict,
          fields: list | None = None, now: datetime | None = None) -> dict:
    """Map the observed MCP shape to the existing ReturnReady input shape.

    Extraction fields must be supplied separately by a reviewer and retain exact
    source quotations/indices. This adapter never invents missing return values.
    """
    now = now or datetime.now(timezone.utc)
    require(isinstance(raw, dict) and len(encoded(raw)) <= MAX_BYTES, 'Invalid or oversized MCP result.')
    require(isinstance(expected_run_id, str) and IDENT.fullmatch(expected_run_id) is not None, 'Supply the expected run ID.')
    require(raw.get('run_id') == expected_run_id, 'Result belongs to a different MCP run.')
    status = raw.get('status')
    require(isinstance(status, str) and status in TERMINAL, 'Only a finished MCP run can be imported; do not redial.')
    observed = timestamp(observed_at)
    require(observed <= now, 'Observation time is in the future.')
    result = raw.get('result')
    require(isinstance(result, dict), 'Missing MCP result object.')
    require(result.get('batch') is None, 'Batch results need separate reconciliation.')
    call_id = result.get('call_id')
    require(call_id is None or isinstance(call_id, str) and IDENT.fullmatch(call_id) is not None, 'Invalid provider call ID.')
    ids = result.get('call_ids', [] if call_id is None else [call_id])
    require(isinstance(ids, list) and ids == ([] if call_id is None else [call_id]), 'Multiple or mismatched call IDs require reconciliation.')
    extracted = result.get('extracted', {})
    require(isinstance(extracted, dict), 'Invalid MCP extraction envelope.')
    calling = extracted.get('calling', {})
    require(isinstance(calling, dict), 'Invalid calling metadata.')
    calls = calling.get('calls', [])
    require(isinstance(calls, list) and len(calls) <= 1, 'Multiple call attempts require manual reconciliation.')
    count = calling.get('callee_count', len(calls))
    require(type(count) is int and 0 <= count <= 1, 'Only one recipient is supported.')
    outcome = result.get('outcome', {})
    require(isinstance(outcome, dict), 'Invalid MCP outcome object.')
    claimed = outcome.get('task_completed')
    require(claimed is None or type(claimed) is bool, 'Provider task completion must be boolean, not truthy text.')
    require(isinstance(consent, dict) and set(consent) == {'state', 'basis'}, 'Supply an explicit consent review and basis.')
    require(isinstance(consent['state'], str) and consent['state'] in CONSENTS, 'Invalid consent choice.')
    consent = {'state': consent['state'], 'basis': string(consent['basis'], 'consent basis', 500)}
    step = raw.get('next_step') or {}
    require(isinstance(step, dict), 'Invalid next-step metadata.')
    repair = extracted.get('repair') or {}
    require(isinstance(repair, dict), 'Invalid repair metadata.')
    decision = repair.get('decision') or {}
    require(isinstance(decision, dict), 'Invalid repair decision.')
    repair_step = decision.get('next_step') or {}
    require(isinstance(repair_step, dict), 'Invalid repair next step.')
    blocked = step.get('action') == 'report_blocked' or repair_step.get('action') == 'report_blocked'
    require(fields is None or isinstance(fields, list) and len(fields) <= 5, 'Use at most five reviewed extraction fields.')
    # No transcript parsing/storage without affirmative permission. A supplied
    # permission review still cannot override a clear refusal in recipient words.
    turns = parse_transcript(result.get('transcript', '')) if consent['state'] == 'granted' else []
    refusal = any(t['speaker'] == 'user' and REFUSAL.search(t['text']) is not None for t in turns)
    receipt = {'format': 'returnready-mcp-receipt', 'version': 1,
               'run_id': expected_run_id, 'call_id': call_id, 'provider_status': status,
               'provider_task_completed': claimed, 'observed_at': observed.isoformat(),
               'input_sha256': fingerprint(raw), 'consent': consent,
               'provider_reported_blocked': blocked, 'recipient_refusal_detected': refusal,
               'provider_error_reported': any(x.get('isError') is True or x.get('ok') is False or bool(x.get('error')) for x in (raw, result)),
               'automatic_retry': False,
               'provenance': 'operator-supplied MCP result; not independently authenticated'}
    reasons = blocked_reasons(receipt)
    permitted = not reasons
    receipt.update(blocked_reasons=reasons, processing_permitted=permitted, transcript_withheld=not permitted)
    validate_receipt(receipt)
    return {'status': 'completed' if permitted else 'failed',
            'task_completed': permitted, 'observed_at': observed.isoformat(),
            'recipients': [{'structured_result': {'fields': copy.deepcopy(fields or []) if permitted else []},
                            'attempts': [{'transcript_turns': turns if permitted else []}]}],
            'mcp_receipt': receipt}


def to_session(raw: Any, *, policy: dict, expected_run_id: str, observed_at: str,
               consent: dict, fields: list | None = None, now: datetime | None = None) -> dict:
    import returnready as rr
    normalized = adapt(raw, expected_run_id=expected_run_id, observed_at=observed_at,
                       consent=consent, fields=fields, now=now)
    rr.inspect(policy, normalized, now)
    return rr.save_session(policy, normalized, False)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--expected-run-id', required=True)
    parser.add_argument('--observed-at', required=True)
    parser.add_argument('--consent', choices=sorted(CONSENTS), default='unknown')
    parser.add_argument('--consent-basis', required=True)
    parser.add_argument('--fields', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        require(args.input.stat().st_size <= MAX_BYTES, 'Input is too large.')
        raw = json.loads(args.input.read_text())
        session = to_session(raw, policy=json.loads(args.policy.read_text()),
                             expected_run_id=args.expected_run_id, observed_at=args.observed_at,
                             consent={'state': args.consent, 'basis': args.consent_basis},
                             fields=json.loads(args.fields.read_text()) if args.fields else None)
        # Do not overwrite another review or the input. No raw transcript in a blocked output.
        with args.output.open('x', encoding='utf-8') as handle:
            handle.write(json.dumps(session, ensure_ascii=False, indent=2)+'\n')
        args.output.chmod(0o600)
        receipt = session['inputs']['response']['mcp_receipt']
        print(json.dumps({'session_written': str(args.output), 'processing_permitted': receipt['processing_permitted'],
                          'transcript_withheld': receipt['transcript_withheld'], 'automatic_retry': False}))
    except (ValueError, OSError, TypeError) as exc:
        parser.exit(2, f'Import rejected: {exc}\n')


if __name__ == '__main__':
    main()
