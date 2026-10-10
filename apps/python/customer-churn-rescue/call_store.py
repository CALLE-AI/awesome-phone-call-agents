import json
from pathlib import Path
from typing import Any, Dict, List, Optional


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
CALLS_FILE = DATA_DIR / "calls.json"


def ensure_storage() -> None:
    """Create the local call-result store if necessary."""

    DATA_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    if not CALLS_FILE.exists():
        CALLS_FILE.write_text(
            "[]",
            encoding="utf-8",
        )


def load_calls() -> List[Dict[str, Any]]:
    """
    Load all stored call results.

    Both synthetic demonstration records and real CALL-E
    execution records live in this same file.
    """

    ensure_storage()

    try:
        with open(
            CALLS_FILE,
            "r",
            encoding="utf-8",
        ) as file:
            data = json.load(file)

        return data if isinstance(data, list) else []

    except (
        OSError,
        json.JSONDecodeError,
    ):
        return []


def save_call_result(
    call_result: Dict[str, Any],
    source: str = "live",
) -> None:
    """
    Save or replace a call result.

    source:
        live
        synthetic_demo
    """

    ensure_storage()

    calls = load_calls()

    result = dict(call_result)

    result["source"] = source

    # CALL-E uses top-level "id".
    # Our synthetic records can use "call_id".
    record_id = (
        result.get("id")
        or result.get("call_id")
    )

    result["record_id"] = record_id

    calls = [
        call
        for call in calls
        if (
            call.get("id")
            or call.get("call_id")
        ) != record_id
    ]

    calls.append(result)

    with open(
        CALLS_FILE,
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            calls,
            file,
            indent=2,
            ensure_ascii=False,
        )


def update_call(
    record_id: str,
    updates: Dict[str, Any],
) -> bool:
    """
    Update an existing call record.

    Returns True when the record was found.
    """

    ensure_storage()

    calls = load_calls()

    updated = False

    for call in calls:

        current_id = (
            call.get("id")
            or call.get("call_id")
            or call.get("record_id")
        )

        if current_id == record_id:

            call.update(updates)

            updated = True

            break

    if not updated:
        return False

    with open(
        CALLS_FILE,
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            calls,
            file,
            indent=2,
            ensure_ascii=False,
        )

    return True


def get_call(
    record_id: str,
) -> Optional[Dict[str, Any]]:
    """Find one stored call."""

    for call in load_calls():

        current_id = (
            call.get("id")
            or call.get("call_id")
            or call.get("record_id")
        )

        if current_id == record_id:
            return call

    return None