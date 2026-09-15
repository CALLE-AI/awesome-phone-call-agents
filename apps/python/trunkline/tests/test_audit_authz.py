"""The audit chain and the live-call authorization record."""
from __future__ import annotations

import json
import os
from datetime import date, timedelta

import pytest

from tests.helpers import bundle_for, context, run, seed
from trunkline import audit, authz, policy


def test_the_chain_verifies_after_a_call(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    run(ctx, bundle_for(ctx, "claim_status"), "claim_status_paid")
    check = audit.verify_chain(data)
    assert check.ok and check.entries >= 3


def test_editing_one_entry_breaks_the_chain(tmp_path):
    data = str(tmp_path)
    seed(data)
    audit.record(data, actor="cli", action="one", subject="a", detail={})
    audit.record(data, actor="cli", action="two", subject="b", detail={})
    audit.record(data, actor="cli", action="three", subject="c", detail={})

    path = audit.audit_path(data)
    lines = open(path, "r", encoding="utf-8").read().strip().split("\n")
    entry = json.loads(lines[1])
    entry["subject"] = "tampered"
    lines[1] = json.dumps(entry, sort_keys=True)
    open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")

    check = audit.verify_chain(data)
    assert not check.ok
    assert check.broken_at == 2


def test_removing_an_entry_breaks_the_chain(tmp_path):
    data = str(tmp_path)
    seed(data)
    for name in ("one", "two", "three"):
        audit.record(data, actor="cli", action=name, subject=name, detail={})
    path = audit.audit_path(data)
    lines = open(path, "r", encoding="utf-8").read().strip().split("\n")
    open(path, "w", encoding="utf-8").write("\n".join([lines[0], lines[2]]) + "\n")
    assert not audit.verify_chain(data).ok


def test_the_audit_log_records_field_names_not_values(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    run(ctx, bundle_for(ctx, "claim_status"), "claim_status_paid")
    planned = [e for e in audit.read_all(data) if e["action"] == "call.planned"][0]
    disclosed = planned["detail"]["disclosed_fields"]
    names = {name for fields in disclosed.values() for name in fields}
    assert names == {"member_id", "date_of_birth", "patient_last_name"}
    assert "W884213097" not in json.dumps(planned)


def test_an_authorization_expires(tmp_path):
    data = str(tmp_path)
    record = authz.write(data, payer_id="p", phone="+12125550142", region="US",
                         until=(date.today() + timedelta(days=1)).isoformat(), max_calls=2)
    assert authz.check(record, phone="+12125550142") is None
    record.until = (date.today() - timedelta(days=1)).isoformat()
    assert authz.check(record, phone="+12125550142") == "authorization_expired"


def test_an_authorization_runs_out_of_calls(tmp_path):
    data = str(tmp_path)
    record = authz.write(data, payer_id="p", phone="+12125550142", region="US",
                         until=(date.today() + timedelta(days=5)).isoformat(), max_calls=1)
    record.calls_used = 1
    assert authz.check(record, phone="+12125550142") == "authorization_exhausted"


def test_revoking_removes_the_record(tmp_path):
    data = str(tmp_path)
    authz.write(data, payer_id="p", phone="+12125550142", region="US",
                until=(date.today() + timedelta(days=5)).isoformat(), max_calls=1)
    assert authz.revoke(data, "p") is True
    assert authz.load(data, "p") is None
    assert authz.check(None, phone="+12125550142") == "no_authorization"


def test_an_authorization_cannot_be_written_for_a_bad_number(tmp_path):
    with pytest.raises(policy.PolicyError):
        authz.write(str(tmp_path), payer_id="p", phone="2125550142", region="US",
                    until=(date.today() + timedelta(days=5)).isoformat(), max_calls=1)


def test_an_authorization_cannot_be_backdated(tmp_path):
    with pytest.raises(authz.AuthorizationError):
        authz.write(str(tmp_path), payer_id="p", phone="+12125550142", region="US",
                    until=(date.today() - timedelta(days=1)).isoformat(), max_calls=1)
