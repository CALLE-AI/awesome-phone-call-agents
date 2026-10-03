"""Tests for api/progress.py and ResolutionStore.update().

Everything here runs below HTTP: the observer is driven by
pipeline.resolve() directly, or by calling its hooks by hand. No route
consumes it yet, which is exactly why it is worth pinning now - the
guarantees it has to keep are easier to state, and to break, before
anything depends on them.
"""

from __future__ import annotations

import io
import json
import re
import threading
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

import pytest

from api.progress import StoreObserver
from api.serialize import resolution_payload
from api.store import ResolutionNotFoundError, ResolutionStore
from client import parse_utc_timestamp
from fake_server import SUBJECT_CANCELLED_PHONE, SUBJECT_VOICEMAIL_PHONE, FakeCalleServer
from pipeline import ResolutionRequest, resolve

HERE = Path(__file__).resolve().parent.parent
ESCALATION = str(HERE / "cases" / "critical-service-escalation.json")
NEAR = "2026-09-10T20:00:00Z"
FAR = "2026-09-01T10:00:00Z"

# Shaped like a credential so a leak would be unmistakable. It is not one.
SENTINEL_KEY = "iams_live_progress_sentinel_not_a_real_credential"


def _request(base_url: str, **overrides: Any) -> ResolutionRequest:
    fields: dict[str, Any] = {
        "case_path": ESCALATION,
        "base_url": base_url,
        "poll_interval_seconds": 0.01,
        "now_utc": parse_utc_timestamp(NEAR),
    }
    fields.update(overrides)
    return ResolutionRequest(**fields)


def _seeded_store() -> tuple[ResolutionStore, str]:
    """A store holding the entry a job creator would have made before
    starting work: queued, and nothing decided yet.
    """
    store = ResolutionStore()
    resolution_id = ResolutionStore.new_id()
    store.put(resolution_id, {"id": resolution_id, "state": "queued", "mode": "fake", "error": None})
    return store, resolution_id


def _run(store: ResolutionStore, resolution_id: str, **overrides: Any) -> Any:
    """resolve() with a StoreObserver, with the client's request logging
    swallowed so it does not drown the test output.
    """
    with FakeCalleServer() as server, redirect_stdout(io.StringIO()):
        return resolve(_request(server.base_url, **overrides), StoreObserver(store, resolution_id))


# --- ResolutionStore.update() ----------------------------------------


def test_update_merges_top_level_keys_and_leaves_the_rest_alone() -> None:
    store, rid = _seeded_store()

    store.update(rid, {"state": "running", "reasoning": {"decision_critical": True}})

    entry = store.get(rid)
    assert entry["state"] == "running"
    assert entry["reasoning"] == {"decision_critical": True}
    assert entry["id"] == rid, "untouched keys must survive"
    assert entry["error"] is None


def test_update_replaces_a_key_whole_rather_than_merging_into_it() -> None:
    store, rid = _seeded_store()
    store.update(rid, {"call": {"placed": True, "provider_status": "in_progress", "result": None}})

    store.update(rid, {"call": {"placed": True, "provider_status": "completed", "result": {"x": 1}}})

    assert store.get(rid)["call"] == {
        "placed": True,
        "provider_status": "completed",
        "result": {"x": 1},
    }


def test_a_snapshot_already_returned_never_changes_under_its_reader() -> None:
    """get() hands out a copy, and this is the invariant that requires it.

    A reader holds its result while it serializes it; a worker keeps
    calling update() on the same resolution. If get() returned the live
    entry, the reader would be looking at a payload that shifts under it -
    half one state, half the next. So the object it already has must stay
    exactly as it was, no matter what happens to the entry afterwards.
    """
    store, rid = _seeded_store()
    store.update(rid, {"state": "running", "verdict": None})

    snapshot = store.get(rid)
    assert snapshot["state"] == "running"

    # Everything a running resolution goes on to publish.
    store.update(rid, {"reasoning": {"decision_critical": True}})
    store.update(rid, {"call": {"placed": True, "provider_status": "completed", "result": None}})
    store.update(rid, {"state": "completed", "verdict": {"status": "RESOLVED", "action": "GO"}})

    assert snapshot["state"] == "running", "the snapshot followed the entry"
    assert snapshot["verdict"] is None
    assert "reasoning" not in snapshot
    assert "call" not in snapshot
    assert snapshot is not store.get(rid), "each read must be its own snapshot"
    assert store.get(rid)["state"] == "completed", "the entry itself did move on"

    # And writing into a snapshot cannot write back into the store.
    snapshot["state"] = "tampered"
    assert store.get(rid)["state"] == "completed"


def test_update_on_an_unknown_id_raises_like_get() -> None:
    store, _ = _seeded_store()

    with pytest.raises(ResolutionNotFoundError):
        store.update("res_never_issued", {"state": "running"})


def test_update_does_not_change_fifo_position() -> None:
    """An update is not a reinsertion. Updating the oldest entry must not
    save it from being evicted first.
    """
    store = ResolutionStore(max_entries=3)
    ids = [ResolutionStore.new_id() for _ in range(3)]
    for index, rid in enumerate(ids):
        store.put(rid, {"n": index})

    store.update(ids[0], {"n": 99})  # touch the oldest
    store.put(ResolutionStore.new_id(), {"n": 3})  # push one in

    with pytest.raises(ResolutionNotFoundError):
        store.get(ids[0])
    assert len(store) == 3


def test_the_cap_and_opaque_ids_are_unchanged_by_update() -> None:
    store = ResolutionStore()
    ids = [ResolutionStore.new_id() for _ in range(250)]
    for rid in ids:
        store.put(rid, {"state": "queued"})
        store.update(rid, {"state": "running"})

    assert len(store) == 200
    assert all(rid.startswith("res_") and len(rid) > 12 for rid in ids)
    assert len(set(ids)) == 250, "ids must stay unique and opaque"
    for leak in ("critical", "escalation", "ghost", "2026", "confirmed"):
        assert not any(leak in rid for rid in ids)


def test_concurrent_updates_and_puts_keep_the_store_consistent() -> None:
    """Barrier rather than sleeps, so the threads collide at a known
    instant. As with put(), the GIL already makes the unlocked version
    survive this - the lock is what makes it a guarantee.
    """
    store = ResolutionStore(max_entries=200)
    pinned = [ResolutionStore.new_id() for _ in range(20)]
    for rid in pinned:
        store.put(rid, {"n": 0})

    barrier = threading.Barrier(30)
    failures: list[BaseException] = []

    def updater(rid: str) -> None:
        try:
            barrier.wait(timeout=15)
            for n in range(50):
                store.update(rid, {"n": n})
        except ResolutionNotFoundError:
            return  # evicted by the writers below; not a broken store
        except BaseException as exc:  # noqa: BLE001
            failures.append(exc)

    def writer() -> None:
        try:
            barrier.wait(timeout=15)
            for _ in range(50):
                store.put(ResolutionStore.new_id(), {"payload": True})
        except BaseException as exc:  # noqa: BLE001
            failures.append(exc)

    workers = [threading.Thread(target=updater, args=(rid,)) for rid in pinned]
    workers += [threading.Thread(target=writer) for _ in range(10)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=60)

    assert not failures, f"a worker raised: {failures[0]!r}"
    assert all(not worker.is_alive() for worker in workers)
    assert len(store) == 200


# --- StoreObserver: the credential must not reach it ------------------


def test_the_observer_does_not_define_on_api_key() -> None:
    """The guarantee is the absence of a method, not a careful one.
    pipeline.resolve() calls observer.on_api_key(api_key) with the real
    credential; inheriting the base class's no-op means it reaches no
    code here at all.
    """
    assert "on_api_key" not in vars(StoreObserver)


def test_calling_on_api_key_directly_stores_nothing() -> None:
    store, rid = _seeded_store()
    before = dict(store.get(rid))

    StoreObserver(store, rid).on_api_key(SENTINEL_KEY)

    assert store.get(rid) == before
    assert SENTINEL_KEY not in json.dumps(store.get(rid))


def test_a_full_run_with_a_key_never_writes_it_to_the_store() -> None:
    store, rid = _seeded_store()

    _run(store, rid, execute=True, api_key=SENTINEL_KEY)

    rendered = json.dumps(store.get(rid))
    assert SENTINEL_KEY not in rendered
    assert "api_key" not in rendered


# --- StoreObserver: progression ---------------------------------------


def test_progress_moves_from_queued_to_running_to_completed() -> None:
    store, rid = _seeded_store()
    assert store.get(rid)["state"] == "queued"

    _run(store, rid, execute=True)

    entry = store.get(rid)
    assert entry["state"] == "completed"
    assert entry["verdict"] == {"status": "RESOLVED", "action": "CONTINUE_DISPATCH"}
    assert entry["call"]["placed"] is True
    assert entry["call"]["provider_status"] == "completed"


def test_each_stage_publishes_only_what_has_become_true() -> None:
    """Hooks driven by hand, so the intermediate states can be observed
    one at a time rather than inferred from the end result.
    """
    store, rid = _seeded_store()
    with FakeCalleServer() as server, redirect_stdout(io.StringIO()):
        observer = StoreObserver(store, rid)
        request = _request(server.base_url, execute=True)

        from evidence.engine import evaluate
        from evidence.model import load_case

        case = load_case(request.case_path)
        observer.on_start(case, "EXECUTE")
        after_start = dict(store.get(rid))
        assert after_start["state"] == "running"
        assert after_start["case"]["name"] == "critical-service-escalation"
        assert len(after_start["evidence"]) == 3
        assert "reasoning" not in after_start, "reasoning is not known yet"
        assert "verdict" not in after_start

        observer.on_reasoning(
            evaluate(case.evidence, case.deadline, request.now_utc, case.decision_deadline_threshold)
        )
        after_reasoning = dict(store.get(rid))
        assert after_reasoning["reasoning"]["decision_critical"] is True
        assert after_reasoning["call_decision"] == "CALL_JUSTIFIED"
        assert "compliance" not in after_reasoning
        assert "call" not in after_reasoning

        observer.on_call_created("call_provider_secret_id", "queued")
        after_created = dict(store.get(rid))
        assert after_created["call"] == {
            "placed": True,
            "provider_status": "queued",
            "result": None,
        }
        assert "call_provider_secret_id" not in json.dumps(after_created), "a provider id leaked"
        assert "verdict" not in after_created, "no verdict exists until on_verdict fires"


def test_the_blocked_branch_publishes_a_next_legal_window() -> None:
    store, rid = _seeded_store()

    _run(store, rid, phone_override="+442079460123")

    entry = store.get(rid)
    assert entry["compliance"]["allowed"] is False
    assert entry["compliance"]["next_legal_window"]
    assert entry["verdict"]["status"] == "UNRESOLVED_CALL_BLOCKED"
    # No call hook ever fires on this branch, so the key is simply
    # absent - which is the honest representation of "none was placed".
    assert "call" not in entry, "no call was placed, so nothing may report one"


def test_the_no_call_branch_completes_without_compliance() -> None:
    store, rid = _seeded_store()

    _run(store, rid, now_utc=parse_utc_timestamp(FAR))

    entry = store.get(rid)
    assert entry["state"] == "completed"
    assert entry["call_decision"] == "NO_CALL_NEEDED"
    assert entry["verdict"] == {"status": "NO_CALL_NEEDED", "action": "NO_ACTION_REQUIRED"}
    assert "compliance" not in entry, "the gate was never consulted, so nothing may report it"


@pytest.mark.parametrize(
    ("phone", "expected_status", "expected_action"),
    [
        (None, "RESOLVED", "CONTINUE_DISPATCH"),
        (SUBJECT_CANCELLED_PHONE, "RESOLVED_ALT", "REASSIGN_TECHNICIAN"),
        (SUBJECT_VOICEMAIL_PHONE, "UNRESOLVED_AMBIGUOUS", "HUMAN_REVIEW"),
    ],
)
def test_every_verdict_branch_reaches_the_store(
    phone: str | None, expected_status: str, expected_action: str
) -> None:
    store, rid = _seeded_store()

    _run(store, rid, execute=True, phone_override=phone)

    assert store.get(rid)["verdict"] == {"status": expected_status, "action": expected_action}


# --- equivalence with the synchronous payload -------------------------


def test_the_published_state_matches_the_payload_the_pipeline_would_produce() -> None:
    """The point of the whole module: a resolution watched stage by stage
    ends up saying the same thing as one serialized in a single shot.

    Compared field by field on the public contract rather than with a
    blind equality, because the observer only writes fields as they
    become true - `error` is never one of them, since a failure is caught
    by whoever owns the job, not by a hook.
    """
    store, rid = _seeded_store()
    resolution = _run(store, rid, execute=True)

    published = store.get(rid)
    expected = resolution_payload(resolution, rid, "completed", "fake")

    for key in ("id", "state", "mode", "case", "evidence", "reasoning", "call_decision", "verdict"):
        assert published[key] == expected[key], f"{key} diverged"

    # call: same projection, and identical here because the projection
    # keeps nothing that varies between two runs (no ids, no timestamps).
    assert published["call"] == expected["call"]
    assert published["compliance"] == expected["compliance"]

    # `error` is present because the seeded entry carried it, not
    # because a hook wrote one: the observer never touches it.
    assert published["error"] is None
    assert set(published) == set(expected), "the published keys must be the public contract"


def test_nothing_sensitive_ever_reaches_the_store() -> None:
    from evidence.model import load_case

    case = load_case(ESCALATION)
    store, rid = _seeded_store()

    _run(store, rid, execute=True, api_key=SENTINEL_KEY)

    rendered = json.dumps(store.get(rid))
    assert case.call_phone not in rendered
    assert not re.search(r"\+[1-9][0-9]{6,14}", rendered), "an unmasked E.164 number reached the store"
    assert case.call_task_hint[:40] not in rendered
    assert "Required disclosure" not in rendered, "the hardened task reached the store"
    assert "transcript" not in rendered
    assert "Hello from the fake server" not in rendered
    assert "provider_call_id" not in rendered
    assert "call_fake" not in rendered, "a provider id reached the store"
    assert "metadata" not in rendered
    assert "evidence_cited" not in rendered
    assert "recipients" not in rendered
    assert "attempts" not in rendered
    assert SENTINEL_KEY not in rendered
