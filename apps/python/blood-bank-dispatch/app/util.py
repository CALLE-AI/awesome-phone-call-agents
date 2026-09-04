def mask_phone(value) -> str:
    """First two characters + last four digits, e.g. +1******2671.

    Used by every rendered view and by log lines; full numbers must not
    appear in either.
    """
    if not value:
        return "—"
    v = str(value)
    if len(v) <= 6:
        return v[0] + "*****"
    return f"{v[:2]}{'*' * (len(v) - 6)}{v[-4:]}"


def sanitize_label(label: str, phone: str) -> str:
    """Display name for an ad-hoc target: must never contain the destination.

    Blank label -> non-phone fallback. A label that repeats the destination
    gets that occurrence replaced with its masked form, so display and log
    values cannot leak the raw number even when the operator typed it.
    """
    clean = (label or "").strip()
    if not clean:
        return "Ad hoc target"
    if phone and phone in clean:
        clean = clean.replace(phone, mask_phone(phone))
    return clean
