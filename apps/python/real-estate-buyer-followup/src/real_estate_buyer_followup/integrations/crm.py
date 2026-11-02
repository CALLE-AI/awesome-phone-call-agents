"""Local CRM adapter. Business rules use snapshots, never raw SQL rows."""
import json
from typing import Protocol
from ..storage import dump, digest, fixture, now


class CRMAdapter(Protocol):
    def context(self, customer_id: str) -> dict: ...
    def apply(self, run: dict, batch: dict, operation_id: str) -> dict: ...


class MockCRM:
    def __init__(self, store, preview_only=True):
        self.store = store
        self.preview_only = preview_only

    def customers(self):
        if self.preview_only:
            return [fixture('crm.json')['customer']]
        with self.store.tx() as db:
            return [json.loads(r[0]) for r in db.execute("SELECT data FROM customers ORDER BY id")]

    def context(self, customer_id):
        if self.preview_only:
            seed=fixture('crm.json')
            if customer_id!=seed['customer']['id']:
                raise ValueError('客户不存在')
            return seed
        with self.store.tx() as db:
            row = db.execute("SELECT data FROM customers WHERE id=?", (customer_id,)).fetchone()
            if not row:
                raise ValueError("客户不存在")
            customer = json.loads(row[0])
            viewings = [json.loads(r[0]) for r in db.execute("SELECT data FROM viewings WHERE customer_id=? ORDER BY id", (customer_id,))]
            properties = [json.loads(r[0]) for r in db.execute("SELECT data FROM properties ORDER BY id")]
            history = [json.loads(r[0]) for r in db.execute("SELECT data FROM communications WHERE customer_id=? ORDER BY id", (customer_id,))]
        return {"scenario_version":fixture('crm.json')['scenario_version'],
                "customer": customer, "viewings": viewings, "properties": properties,
                "communications": history, "candidates": fixture("crm.json")["candidates"],
                "evaluation_date": fixture("crm.json")["evaluation_date"]}

    def apply(self, run, batch, operation_id, fail_hook=None):
        """Atomically update CRM, append evidence history, and persist receipt.

        The receipt is the idempotency boundary, including a stale retry after a
        newer customer edit. The optional hook is only for rollback testing.
        """
        if self.preview_only:
            raise ValueError('当前演示仅预览，禁止写入CRM')
        payload_hash = digest(batch)
        with self.store.tx() as db:
            saved = db.execute("SELECT payload_hash,data FROM receipts WHERE id=?", (operation_id,)).fetchone()
            if saved:
                if saved[0] != payload_hash:
                    raise ValueError("同一写入身份不能对应不同内容")
                return json.loads(saved[1])
            row = db.execute("SELECT version,data FROM customers WHERE id=?", (run["customer_id"],)).fetchone()
            if row[0] != batch["expected_version"]:
                raise ValueError("客户资料版本已变化，须重新核对，未覆盖现有数据")
            c = json.loads(row[1])
            applied = []
            for entry in batch["accepted"]:
                target, field = entry["target_id"], entry["field"]
                if entry["kind"] == "preference":
                    old = c.get(field) if field == "contact_allowed" else c["preferences"].get(field)
                    if old != entry["old_value"]:
                        raise ValueError("字段旧值已变化，未覆盖新数据")
                    if field == "contact_allowed":
                        c[field] = entry["value"]
                    else:
                        c["preferences"][field] = entry["value"]
                else:
                    vrow = db.execute("SELECT data FROM viewings WHERE id=? AND customer_id=?", (target, c["id"])).fetchone()
                    if not vrow:
                        raise ValueError("带看记录不属于当前客户")
                    v = json.loads(vrow[0])
                    if v["property_id"] != entry["property_id"]:
                        raise ValueError("房源与带看不一致")
                    v["feedback"].append({"id":entry["id"], "dimension":field, "text":entry["value"], "evidence":entry["evidence"]})
                    db.execute("UPDATE viewings SET data=? WHERE id=?", (dump(v), target))
                db.execute("INSERT INTO changes VALUES(?,?,?,?,?,?,?,?)", (
                    entry["id"], run["id"], target, field, dump(entry["old_value"]), dump(entry["value"]), dump(entry["evidence"]), now()))
                applied.append(entry)
            handoff = batch["handoff"]
            if not c["contact_allowed"]:
                c["intent"], c["handoff_required"] = "停止联系", False
            elif handoff.get("priority") == "high":
                c["intent"], c["handoff_required"] = "明确推进信号", True
            elif any(e['field']=='next_viewing_interest' for e in batch['accepted']):
                c['intent'], c['handoff_required'] = '有继续看房意愿', False
            if handoff.get("priority") == "high" and c["contact_allowed"]:
                key = digest([run["id"], "handoff"])
                db.execute("INSERT OR IGNORE INTO notifications VALUES(?,?,?,?)", (key, run["id"], "handoff", dump(handoff)))
            if batch["accepted"] or (handoff.get("priority") == "high" and c["contact_allowed"]):
                c["version"] += 1
                db.execute("UPDATE customers SET version=?,data=? WHERE id=?", (c["version"], dump(c), c["id"]))
            if fail_hook:
                fail_hook()
            receipt = {"operation_id":operation_id, "applied":applied, "pending":batch["pending"],
                       "unresolved":batch["unresolved"], "handoff":handoff,
                       "customer_version":c["version"], "created_at":now()}
            db.execute("INSERT INTO receipts VALUES(?,?,?,?)", (operation_id, run["id"], payload_hash, dump(receipt)))
            return receipt

    def notifications(self, run_id):
        with self.store.tx() as db:
            return [json.loads(r[0]) for r in db.execute("SELECT data FROM notifications WHERE run_id=?", (run_id,))]
