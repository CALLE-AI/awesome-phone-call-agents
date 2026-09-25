"""Background automation engine.

This is what makes Relay place calls on its own instead of waiting for
someone to click a button. On an interval, it looks at real entity state —
using actual wall-clock time via `datetime`, not a static seeded flag — and
if a condition is currently open, places the call itself through the exact
same `execute_call` function the manual "Call" buttons use. There is one
code path for "a call gets placed," whether a human or the scheduler asked
for it.

Disclosure (see CONTRIBUTING.md's "no hidden recurring schedules" rule):
this loop is visible and controllable from the app, not just this file —
GET /api/automation/status reports it, POST /api/automation/run-once can
force an immediate pass, and turning the "Automatic follow-ups" setting off
pauses it entirely. See the README's "Automation" and "Stopping automated
calls" sections.
"""

import os
import threading
import time as time_module
import uuid
from datetime import datetime

from .db import get_state, entity as get_entity, update_entity, redact

INTERVAL_SECONDS = int(os.environ.get('AUTOMATION_INTERVAL_SECONDS', '20'))
CHECKIN_DEADLINE_HOUR = int(os.environ.get('CHECKIN_DEADLINE_HOUR', '10'))  # matches the employee policy's 10:00 AM
RENEWAL_WINDOW_DAYS = int(os.environ.get('RENEWAL_WINDOW_DAYS', '7'))
LOW_UTILIZATION_THRESHOLD = 0.5

FEATURE_FOR = {'employee': 'employee_operations', 'customer': 'customer_lifecycle', 'license': 'vendor_optimization'}

_execute_call = None
_refresh_call = None

_status = {'running': False, 'interval_seconds': INTERVAL_SECONDS, 'last_run': None, 'last_result': []}
_status_lock = threading.Lock()
_tick_lock = threading.Lock()

_in_flight = {}  # (pillar, entity_id) -> call_id, for live calls still awaiting a result

_pending_reconciliation = {}  # (pillar, entity_id) -> unresolved attempt

def wire(execute_call_fn, refresh_call_fn):
    """Dependency injection instead of importing app.py directly, which
    would create a circular import (app.py also has to import this module
    to start the loop)."""
    global _execute_call, _refresh_call
    _execute_call = execute_call_fn
    _refresh_call = refresh_call_fn


def days_until(date_str):
    if not date_str:
        return None
    try:
        target = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return None
    return (target - datetime.now().date()).days


def _signature(e):
    # Cheap "has this entity's open condition changed since we last acted on
    # it" check, without a separate tracking table — reuses fields that
    # apply_result() already updates when a call resolves.
    return '|'.join(str(e.get(k)) for k in (
        'flag', 'attendance_status', 'renewal_status', 'optimization_status'
    ))


def _already_handled(e):
    return e.get('_auto_handled_for') == _signature(e)


def _mark_handled(pillar, e):
    fresh = get_entity(pillar, e['id']) or e
    update_entity(pillar, e['id'], {'_auto_handled_for': _signature(fresh)})

def _fire(pillar, e, act, fired):
    key = (pillar, e['id'])

    # Never create another call while the previous attempt is unresolved.
    if key in _in_flight or key in _pending_reconciliation:
        return

    # Generate the idempotency key BEFORE making the CALL-E request.
    # If the request outcome becomes unknown, this exact key is preserved
    # in _pending_reconciliation so the operation is not retried with a
    # different key.
    idempotency_key = f'relay-op-{uuid.uuid4().hex}'

    try:
        result = _execute_call(
            pillar,
            e['id'],
            act,
            idempotency_key=idempotency_key,
            live_intent=True
        )

    except Exception as ex:
        # The request may have reached CALL-E even if we never received
        # its response. Do NOT retry automatically.
        _pending_reconciliation[key] = {
            'pillar': pillar,
            'entity_id': e['id'],
            'act': act,
            'idempotency_key': idempotency_key,
            'error': str(ex),
            'detected_at': datetime.now().isoformat(),
        }

        fired.append({
            'pillar': pillar,
            'entityId': e['id'],
            'act': act,
            'status': 'pending_reconciliation',
            'error': str(ex),
        })
        return

    if result.get('dryRun', True):
        # Dry-run calls resolve synchronously.
        _mark_handled(pillar, e)

        fired.append({
            'pillar': pillar,
            'entityId': e['id'],
            'act': act,
            'callId': result.get('callId'),
            'dryRun': True,
            'status': 'completed',
        })

    else:
        call_id = result.get('callId')

        if not call_id:
            # We received a response, but cannot safely identify the call.
            # Hold the operation for reconciliation instead of retrying.
            _pending_reconciliation[key] = {
                'pillar': pillar,
                'entity_id': e['id'],
                'act': act,
                'idempotency_key': idempotency_key,
                'error': 'CALL-E response did not contain a call ID',
                'detected_at': datetime.now().isoformat(),
            }

            fired.append({
                'pillar': pillar,
                'entityId': e['id'],
                'act': act,
                'status': 'pending_reconciliation',
            })
            return

        _in_flight[key] = call_id

        fired.append({
            'pillar': pillar,
            'entityId': e['id'],
            'act': act,
            'callId': call_id,
            'dryRun': False,
            'status': 'queued',
        })
        
def _resolve_in_flight():
    if not _refresh_call:
        return

    for key, call_id in list(_in_flight.items()):
        try:
            record = _refresh_call(call_id)
        except Exception:
            # Keep the call in flight. Do not create another call.
            continue

        if record and record.get('status') in (
            'completed',
            'failed',
            'canceled'
        ):
            pillar, entity_id = key
            e = get_entity(pillar, entity_id)

            if e:
                _mark_handled(pillar, e)

            del _in_flight[key]

def run_once():
    if _execute_call is None:
        return []
    if not _tick_lock.acquire(blocking=False):
        return []  # a tick is already running; skip rather than overlap
    fired = []
    try:
        _resolve_in_flight()
        state = get_state()
        settings = state['settings']
        if not settings.get('automatic_followups', True):
            with _status_lock:
                _status['last_run'] = datetime.now().isoformat()
                _status['last_result'] = []
            return []
        now = datetime.now()

        if settings.get(FEATURE_FOR['employee'], True):
            for e in state['employees']:
                key = ('employee', e['id'])
                if key in _in_flight:
                    continue
                if e.get('flag') == 'Offboarding today' and not _already_handled(e):
                    _fire('employee', e, 'offboard', fired)
                    continue
                if (e.get('attendance_status') == 'absent' and e.get('flag') != 'Escalation required'
                        and now.hour >= CHECKIN_DEADLINE_HOUR and not _already_handled(e)):
                    _fire('employee', e, 'checkin', fired)

        if settings.get(FEATURE_FOR['customer'], True):
            for c in state['customers']:
                key = ('customer', c['id'])
                if key in _in_flight:
                    continue
                d = days_until(c.get('renewal_date'))
                if (c.get('flag') in ('Renewal due', 'At risk') and d is not None
                        and 0 <= d <= RENEWAL_WINDOW_DAYS and not _already_handled(c)):
                    _fire('customer', c, 'renewal', fired)

        if settings.get(FEATURE_FOR['license'], True):
            for l in state['licenses']:
                key = ('license', l['id'])
                if key in _in_flight:
                    continue
                if l.get('flag') == 'Reclaim needed' and not _already_handled(l):
                    _fire('license', l, 'seat-reclaim', fired)
                    continue
                purchased = l.get('seats_purchased', 0) or 0
                active = l.get('seats_active', 0) or 0
                util = (active / purchased) if purchased else 1
                d = days_until(l.get('renewal_date'))
                if (util < LOW_UTILIZATION_THRESHOLD and d is not None and 0 <= d <= RENEWAL_WINDOW_DAYS
                        and l.get('optimization_status') != 'optimized' and not _already_handled(l)):
                    _fire('license', l, 'usage-review', fired)
    finally:
        _tick_lock.release()

    with _status_lock:
        _status['last_run'] = datetime.now().isoformat()
        _status['last_result'] = fired
    return fired

def get_pending_reconciliation():
    return {
        f'{pillar}:{entity_id}': {
            'pillar': info.get('pillar'),
            'entity_id': info.get('entity_id'),
            'act': info.get('act'),
            'error': redact(info.get('error')),
            'detected_at': info.get('detected_at'),
        }
        for (pillar, entity_id), info
        in _pending_reconciliation.items()
    }

def start_background_loop():
    def _loop():
        with _status_lock:
            _status['running'] = True
        while True:
            run_once()
            time_module.sleep(INTERVAL_SECONDS)

    thread = threading.Thread(target=_loop, daemon=True, name='relay-automation')
    thread.start()

def get_status():
    with _status_lock:
        status = dict(_status)

    status['last_result'] = [
        {**item, 'error': redact(item['error'])} if 'error' in item else item
        for item in status.get('last_result', [])
    ]

    status['in_flight'] = {
        f'{pillar}:{entity_id}': call_id
        for (pillar, entity_id), call_id in _in_flight.items()
    }

    status['pending_reconciliation'] = get_pending_reconciliation()

    return status