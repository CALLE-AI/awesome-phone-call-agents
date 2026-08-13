import re


# Strict E.164:
# - starts with +
# - first digit cannot be 0
# - total digits after + must be 8 to 15
E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")


def is_valid_e164(phone_number: str) -> bool:
    """
    Return True only for strict E.164 phone numbers.

    Valid examples:
        +919876543210
        +14155552671

    Invalid examples:
        +not-a-phone
        9876543210
        +0123456789
        +91 98765 43210
    """
    if not isinstance(phone_number, str):
        return False

    phone_number = phone_number.strip()
    return bool(E164_PATTERN.fullmatch(phone_number))


def can_call_business(business: dict) -> tuple[bool, str]:
    """
    Fail closed before any live call is dispatched.

    Expected business fields:
        authorized_for_calling: bool
        do_not_call: bool
        phone_number: str
    """
    if not isinstance(business, dict):
        return False, "Invalid business record."

    if business.get("authorized_for_calling") is not True:
        return False, "Business is not authorized for calling."

    if business.get("do_not_call") is True:
        return False, "Business has opted out of calls."

    phone_number = business.get("phone_number")

    if not phone_number:
        return False, "Business phone number is missing."

    if not is_valid_e164(phone_number):
        return False, "Business phone number is not valid E.164."

    return True, "Call allowed."


def mask_phone_number(phone_number: str) -> str:
    """
    Mask a phone number for logs/UI so the full number is not exposed.
    """
    if not isinstance(phone_number, str) or not phone_number:
        return "***"

    phone_number = phone_number.strip()

    if len(phone_number) <= 4:
        return "*" * len(phone_number)

    return f"{phone_number[:3]}{'*' * max(len(phone_number) - 7, 3)}{phone_number[-4:]}"
