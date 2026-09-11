"""Explicit, information-only rechecks of unresolved offers.

The history is immutable. Only the most recent inquiry for a contact supplies its
current offer: do not combine a new price with old task promises.
"""
from __future__ import annotations


def latest_inquiries(calls: list[dict]) -> list[dict]:
    # callers supply ordinal/creation-ordered history
    latest = {}
    for call in calls:
        latest[call['business_id']] = call
    return list(latest.values())


def conditional_candidates(run: dict) -> list[dict]:
    """Evidence candidates, not permission to call. Directory checks are server-side."""
    missing = {n['id'] for n in run['plan']['requirements'] if n['status'] != 'covered'}
    candidates = []
    for call in latest_inquiries(run['calls']):
        analysis = call.get('analysis') or {}
        if call.get('status') != 'completed' or analysis.get('recipient_confirmed') != 'yes':
            continue
        assessments = [a for a in analysis.get('assessments', [])
                       if a['requirement_id'] in missing and a['status'] == 'conditional']
        if not assessments:
            continue
        candidates.append({'contact_id': call['business_id'], 'call_id': call['id'],
                           'name': call['business_name'],
                           'conditions': list(dict.fromkeys(x for a in assessments for x in a.get('conditions', [])))
                                         or ['Availability still needs confirmation.'],
                           'requirement_ids': [a['requirement_id'] for a in assessments]})
    return candidates


def rule_resolutions(evidence: dict, followup: dict) -> list[dict]:
    """Conservative backup: generic availability does not clear an earlier condition."""
    import re
    from coordinator import recipient_texts
    results = {}
    for text in recipient_texts(evidence):
        # A later pending statement overrides a previous confirmation.
        pending = re.search(r"\b(not|hasn't|haven't|pending|waiting|only after|still need)\b", text, re.I)
        all_conditions = re.search(r"\b(?:all|our|the) (?:earlier |previous )?(?:conditions|prerequisites) (?:are |have been )?(?:now |fully )?(?:resolved|met|cleared|confirmed)\b", text, re.I)
        for i, condition in enumerate(followup.get('conditions', [])):
            supervisor = re.search(r'\b(supervisor|manager)\b', condition, re.I)
            mentions_supervisor = supervisor and re.search(r'\b(supervisor|manager)\b', text, re.I)
            specific = mentions_supervisor and re.search(r'\b(confirmed|approved|given (?:the )?(?:go-ahead|permission)|said yes)\b', text, re.I)
            if pending and (mentions_supervisor or re.search(r'\b(conditions|prerequisites)\b', text, re.I)):
                results.pop(i, None)
            elif not pending and (all_conditions or specific):
                results[i] = {'condition_index': i, 'evidence_quote': text[:1600]}
    return list(results.values())


def validate_resolutions(result: dict, evidence: dict, followup: dict) -> dict:
    """Do not promote silence about an old prerequisite into a verified offer."""
    from coordinator import recipient_texts, supported_quote, CONDITIONAL, NEGATIVE
    texts = recipient_texts(evidence)
    count = len(followup.get('conditions', []))
    verified = {}
    for item in result.get('condition_resolutions', []):
        quote = item['evidence_quote']
        if (0 <= item['condition_index'] < count and supported_quote(quote, texts)
                and not NEGATIVE.search(quote) and not CONDITIONAL.search(quote)):
            verified[item['condition_index']] = max(i for i, text in enumerate(texts) if supported_quote(quote, [text]))
    # A later explicit pending statement wins even over an earlier grounded quote.
    # The normal assessment validator separately handles task-specific refusal.
    import re
    for i, text in enumerate(texts):
        if re.search(r'\b(supervisor|manager|conditions|prerequisites)\b', text, re.I) and re.search(
                r"\b(pending|waiting|not confirmed|not approved|not resolved|hasn't approved|only after|still need|revoked|withdrawn)\b", text, re.I):
            verified = {index: at for index, at in verified.items() if at > i}
    if set(verified) != set(range(count)):
        for assessment in result['assessments']:
            if assessment['requirement_id'] in followup['requirement_ids'] and assessment['status'] == 'committed':
                assessment.update(status='conditional', eta_minutes=None,
                                  conditions=followup['conditions'])
        result['validation_notes'].append('The earlier condition was not explicitly verified as resolved in this reply.')
        if any(a['status'] == 'conditional' for a in result['assessments']):
            result['summary'] = 'The earlier condition still needs confirmation; this is not yet a firm offer.'
    return result
