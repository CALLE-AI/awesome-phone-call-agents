"""Idempotent seed for disease protocols.

Reads:
  scripts/seed_data/diseases.json
  scripts/seed_data/overlays.json

Behavior:
  - Inserts missing protocols
  - Updates existing protocols by code (name/description/flags)
  - Replaces questions, keywords, and result fields for existing protocols
    so re-running refreshes overlay content without duplicates

Run from project root:
  python -m scripts.seed_protocols
"""

from __future__ import annotations

import json
from pathlib import Path

from app.db import SessionLocal
from app.models.orm import (
    DiseaseProtocol,
    ProtocolEmergencyKeyword,
    ProtocolQuestion,
    ProtocolResultField,
    ProtocolResultFieldEnum,
)
from sqlalchemy.orm import Session

DATA_DIR = Path(__file__).resolve().parent / "seed_data"


def _load_json(name: str):
    path = DATA_DIR / name
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _merge_overlay(base: dict, category: dict) -> dict:
    questions = list(base.get("questions", [])) + list(category.get("questions", []))
    keywords = list(dict.fromkeys(list(base.get("keywords", [])) + list(category.get("keywords", []))))
    fields = list(base.get("fields", [])) + list(category.get("fields", []))

    # De-dupe fields by field_key, preferring category-specific later entries
    by_key: dict[str, dict] = {}
    for field in fields:
        by_key[field["field_key"]] = field

    return {
        "questions": questions,
        "keywords": keywords,
        "fields": list(by_key.values()),
    }


def _clear_children(db: Session, protocol_id: int) -> None:
    """Hard-delete child rows and flush so unique constraints don't collide on re-seed."""
    field_ids = [
        row[0]
        for row in db.query(ProtocolResultField.id)
        .filter(ProtocolResultField.protocol_id == protocol_id)
        .all()
    ]
    if field_ids:
        db.query(ProtocolResultFieldEnum).filter(
            ProtocolResultFieldEnum.field_id.in_(field_ids)
        ).delete(synchronize_session=False)

    db.query(ProtocolResultField).filter(
        ProtocolResultField.protocol_id == protocol_id
    ).delete(synchronize_session=False)
    db.query(ProtocolQuestion).filter(
        ProtocolQuestion.protocol_id == protocol_id
    ).delete(synchronize_session=False)
    db.query(ProtocolEmergencyKeyword).filter(
        ProtocolEmergencyKeyword.protocol_id == protocol_id
    ).delete(synchronize_session=False)
    db.flush()


def _apply_overlay(protocol: DiseaseProtocol, overlay: dict) -> None:
    for i, text in enumerate(overlay["questions"]):
        protocol.questions.append(
            ProtocolQuestion(
                question_text=text,
                sort_order=i,
                is_required=True,
                is_active=True,
            )
        )

    for keyword in overlay["keywords"]:
        protocol.emergency_keywords.append(
            ProtocolEmergencyKeyword(keyword=keyword, is_active=True)
        )

    for i, field_def in enumerate(overlay["fields"]):
        field = ProtocolResultField(
            field_key=field_def["field_key"],
            field_type=field_def["field_type"],
            description=field_def.get("description"),
            is_required=bool(field_def.get("is_required", True)),
            sort_order=i,
            minimum=field_def.get("minimum"),
            maximum=field_def.get("maximum"),
            is_active=True,
        )
        for j, value in enumerate(field_def.get("enums") or []):
            field.enums.append(
                ProtocolResultFieldEnum(value=value, sort_order=j)
            )
        protocol.result_fields.append(field)


def seed_protocols(db: Session) -> dict[str, int]:
    diseases = _load_json("diseases.json")
    overlays = _load_json("overlays.json")
    base = overlays["base"]
    categories = overlays["categories"]

    existing = {
        p.code: p
        for p in db.query(DiseaseProtocol).all()
    }

    created = 0
    updated = 0

    for item in diseases:
        code = item["code"]
        category = item["category"]
        if category not in categories:
            raise ValueError(f"Unknown category '{category}' for disease '{code}'")

        overlay = _merge_overlay(base, categories[category])
        protocol = existing.get(code)

        if protocol is None:
            protocol = DiseaseProtocol(
                code=code,
                name=item["name"],
                description=item.get("description"),
                needs_followup_default=True,
                is_active=True,
            )
            db.add(protocol)
            db.flush()  # need protocol.id before child inserts
            created += 1
        else:
            protocol.name = item["name"]
            protocol.description = item.get("description")
            protocol.needs_followup_default = True
            protocol.is_active = True
            _clear_children(db, protocol.id)
            updated += 1

        _apply_overlay(protocol, overlay)

    db.commit()
    return {"created": created, "updated": updated, "total": created + updated}


def main() -> None:
    db = SessionLocal()
    try:
        result = seed_protocols(db)
        print(
            f"Seed complete. created={result['created']} "
            f"updated={result['updated']} total={result['total']}"
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
