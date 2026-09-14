from app.models.orm import Call
from sqlalchemy.orm import Session, joinedload


class CallRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, call_id: int) -> Call | None:
        return (
            self.db.query(Call)
            .options(joinedload(Call.symptoms), joinedload(Call.followup))
            .filter(Call.id == call_id)
            .first()
        )

    def get_by_provider_id(self, provider_call_id: str) -> Call | None:
        return (
            self.db.query(Call)
            .options(joinedload(Call.followup))
            .filter(Call.calle_call_id == str(provider_call_id))
            .first()
        )

    def list_all(self) -> list[Call]:
        return (
            self.db.query(Call)
            .options(joinedload(Call.symptoms))
            .order_by(Call.id.desc())
            .all()
        )

    def create(self, call: Call) -> Call:
        self.db.add(call)
        self.db.commit()
        self.db.refresh(call)
        return call

    def save(self, call: Call) -> Call:
        self.db.commit()
        self.db.refresh(call)
        return call
