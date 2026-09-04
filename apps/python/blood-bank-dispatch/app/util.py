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
