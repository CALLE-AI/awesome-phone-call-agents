from calle import CalleClient
from config import CALLE_API_KEY

_client = None


def _get_client() -> CalleClient:
    global _client
    if _client is None:
        _client = CalleClient(api_key=CALLE_API_KEY)
    return _client


def make_call(phone: str, goal: str,
              region: str = "IN", locale: str = "en-IN",
              timeout_seconds: float = 300.0) -> dict:
    return _get_client().calls.create_and_wait(
        task=goal,
        recipient={
            "phone": phone,
            "region": region,
            "locale": locale,
        },
        timeout_seconds=timeout_seconds,
    )


def get_call_status(call_id: str) -> dict:
    return _get_client().calls.get(call_id)
