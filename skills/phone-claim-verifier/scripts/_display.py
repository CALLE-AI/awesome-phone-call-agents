"""Phone masking for display only; private plans and evidence remain unchanged."""

import argparse
import re

_PHONE = re.compile(r"(?<!\w)\+?\d[\d ().-]{6,}\d(?!\w)")


def mask_text(text: str) -> str:
    def replace(match):
        candidate = match.group(0)
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate):
            return candidate
        digits = re.sub(r"\D", "", candidate)
        return f"[phone ending {digits[-4:]}]"
    return _PHONE.sub(replace, text)


def for_display(value):
    if isinstance(value, str):
        return mask_text(value)
    if isinstance(value, list):
        return [for_display(item) for item in value]
    if isinstance(value, dict):
        return {mask_text(str(key)): for_display(item) for key, item in value.items()}
    return value


class DisplayArgumentParser(argparse.ArgumentParser):
    def _print_message(self, message, file=None):
        super()._print_message(mask_text(message) if message else message, file)
