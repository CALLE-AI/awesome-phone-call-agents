"""Presentation-only phone redaction; never mutate dispatch or evidence inputs."""
from collections.abc import Mapping
import re

# Match contiguous and commonly formatted national/international numbers.
# Alphanumeric boundaries avoid matching digits embedded in IDs or hashes.
_PHONE = re.compile(r'(?<![A-Za-z0-9_])(?:\+\s*)?(?:\(\d{1,4}\)|\d)[\d\s().-]{5,}\d(?![A-Za-z0-9_])')


def redact_text(text):
    def mask(match):
        value = match.group(0)
        digits = re.sub(r'\D', '', value)
        # Also hide adjacent numeric callbacks that form an overlong sequence.
        if len(digits) < 7:
            return value
        # Preserve common ISO calendar dates, which are not callback numbers.
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            return value
        return '[phone hidden]'
    return _PHONE.sub(mask, text)


def redact(value):
    """Return a detached display value, including nested JSON keys and values."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, Mapping):
        return {redact(k): redact(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    # Model/provider JSON can encode a phone as an integer.
    if type(value) is int and 10 <= len(str(abs(value))) <= 15:
        return '[number hidden]'
    return value


class Presentation:
    """Guard every textual Streamlit output, including column-bound outputs.

    Input widgets and execution callbacks retain their original values. This
    facade is intentionally confined to the UI; persistence, evidence checking,
    provider requests and recording playback receive untouched private data.
    """
    _OUTPUTS = frozenset({
        'write', 'text', 'markdown', 'caption', 'code', 'json', 'dataframe',
        'table', 'metric', 'error', 'warning', 'info', 'success', 'exception',
        'title', 'header', 'subheader',
    })

    def __init__(self, target):
        self._target = target

    def __getattr__(self, name):
        method = getattr(self._target, name)
        if name == 'columns':
            return lambda *a, **k: [Presentation(c) for c in method(*a, **k)]
        if name in self._OUTPUTS:
            def display(*args, **kwargs):
                if name == 'exception':
                    return self._target.error(redact_text(str(args[0])))
                return method(*(redact(a) for a in args),
                              **{k: redact(v) for k, v in kwargs.items()})
            return display
        return method

    def __enter__(self):
        self._target.__enter__()
        return self

    def __exit__(self, *args):
        return self._target.__exit__(*args)
