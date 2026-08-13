def can_call_business(business: dict) -> tuple[bool, str]:
    if not business.get("authorized", False):
        return False, "Business is not authorized for outreach."

    if business.get("do_not_call", False):
        return False, "Business has requested no further calls."

    phone = business.get("phone", "").strip()

    if not phone:
        return False, "Phone number is missing."

    if not phone.startswith("+"):
        return False, "Phone number must be in E.164 format."

    return True, "Eligible for calling."


def mask_phone_number(phone: str) -> str:
    if len(phone) <= 4:
        return "****"

    return f"{phone[:3]}******{phone[-2:]}"