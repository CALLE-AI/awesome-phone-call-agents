"""Limited check-only intent recognition; not diagnosis or a general language model."""
import re
from rescue_intent import medical_assessment, assessment_only


def observation_only(text: str) -> bool:
    if assessment_only(text or ''):
        return False
    text=(text or '').casefold().replace('’', "'")
    clauses=re.split(r'[.;,\n]|\bbut\b',text)
    positive=' '.join(re.split(r"\b(?:do not|don't|must not|should not|without|no need to|not|no)\b",clause,maxsplit=1)[0] for clause in clauses)
    check=re.search(r'\b(?:check(?:ing)?(?:\s+on)?|observe|observing|observation|watch(?:ing)?|monitor(?:ing)?|keep(?:ing)? an eye|look(?:ing)? at)\b',positive)
    broader=re.search(r'\b(?:transport|ride|drive|clinic|hospital|vet|veterinary|veterinarian|shelter|pick[ -]?up|capture|catch|contain|containment|secure|rescue|remove|move|moving|relocate|treat|treatment|out of danger|off the road|safe place|bring|take|feed|feeding|food|water)\b',positive)
    return bool(check and not broader)
