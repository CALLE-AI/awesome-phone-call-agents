import os
import requests
import re
import uuid

from urllib.parse import urlparse


BASE = os.getenv(
    'CALLE_BASE_URL',
    'https://api.heycall-e.com'
).rstrip('/')

API_KEY = os.getenv('CALLE_API_KEY', '')
AUTHORIZED_NUMBERS = {
    n.strip() for n in os.getenv('CALLE_AUTHORIZED_NUMBERS', '').split(',') if n.strip()
}
APPROVED_CALLE_ORIGIN = 'https://api.heycall-e.com'


def validate_calle_base():
    parsed = urlparse(BASE)

    if parsed.scheme != 'https':
        raise RuntimeError('CALL-E API must use HTTPS')

    origin = f'{parsed.scheme}://{parsed.netloc}'

    if origin != APPROVED_CALLE_ORIGIN:
        raise RuntimeError(
            f'Unapproved CALL-E origin: {origin}'
        )


validate_calle_base()


DRY_RUN = (
    (not API_KEY)
    or os.getenv('CALLE_DRY_RUN', 'true').lower() == 'true'
)


def create_call(task, entity, result_schema, metadata, idempotency_key=None, live_intent=False):
    if DRY_RUN:
        return {
            'id': 'dryrun_' + uuid.uuid4().hex,
            'status': 'completed',
            'metadata': metadata,
            'dry_run': True,
            'simulated': True
        }
    if not live_intent:
       raise ValueError(
           'live_intent must be explicitly set to place a real CALL-E call'
       )
    phone = entity.get('phone')

    if not phone:
        raise ValueError('CALL-E recipient has no phone number')

    # Require E.164-style phone numbers.
    if not isinstance(phone, str) or not phone.startswith('+'):
        raise ValueError(
            'CALL-E recipient phone number must use E.164 format'
        )

    digits = phone[1:]

    if not re.fullmatch(r'[0-9]{8,15}', digits):
        raise ValueError(
            'CALL-E recipient phone number must use E.164 format'
        )

    if phone not in AUTHORIZED_NUMBERS:
        raise ValueError(
            'CALL-E recipient is not an authorized destination'
        )
    
    payload = {
        'task': task,
        'recipients': [{
            'phones': [phone],
            'region': 'US',
            'locale': 'en-US'
        }],
        'result_schema': result_schema,
        'metadata': metadata
    }

    # A logical operation supplies its own idempotency key.
    # If one was not supplied, generate one for this call.
    #
    # The automation layer will eventually supply a persistent key
    # for operations that need reconciliation.
    if not idempotency_key:
        raise ValueError(
            'idempotency_key is required for live CALL-E calls'
        )

    r = requests.post(
        f'{BASE}/v1/calls',
        headers={
            'Authorization': f'Bearer {API_KEY}',
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotency_key
        },
        json=payload,
        timeout=30,
        allow_redirects=False
    )

    if 300 <= r.status_code < 400:
        raise RuntimeError(
            'CALL-E request was redirected; refusing to forward credentials'
        )

    r.raise_for_status()

    return r.json() | {
        'dry_run': False,
        'idempotency_key': idempotency_key
    }


def get_call(call_id):
    if call_id.startswith('dryrun_'):
        return None

    r = requests.get(
        f'{BASE}/v1/calls/{call_id}',
        headers={
            'Authorization': f'Bearer {API_KEY}'
        },
        timeout=30,
        allow_redirects=False
    )

    if 300 <= r.status_code < 400:
        raise RuntimeError(
            'CALL-E request was redirected; refusing to forward credentials'
        )

    r.raise_for_status()

    return r.json()