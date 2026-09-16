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
from datetime import datetime

from .db import get_state, entity as get_entity, update_entity

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
    try:
        result = _execute_call(pillar, e['id'], act)
    except Exception as ex:
        fired.append({'pillar': pillar, 'entityId': e['id'], 'act': act, 'error': str(ex)})
        return
    if result.get('dryRun', True):
        # Dry-run calls resolve synchronously inside execute_call() — the
        # entity has already been updated, so it's safe to mark handled now.
        _mark_handled(pillar, e)
    else:
        # Live calls are still pending. Track it so a later tick can poll
        # and resolve it, instead of re-firing on the same open condition
        # every interval while it's still in flight.
        _in_flight[key] = result.get('callId')
    fired.append({'pillar': pillar, 'entityId': e['id'], 'act': act, 'callId': result.get('callId'), 'dryRun': result.get('dryRun', True)})


def _resolve_in_flight():
    if not _refresh_call:
        return
    for key, call_id in list(_in_flight.items()):
        record = _refresh_call(call_id)
        if record and record.get('status') in ('completed', 'failed', 'canceled'):
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
        return dict(_status)
