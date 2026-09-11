from sqlalchemy.orm import Session

from app.models.orm import Symptom


class SymptomRepository:
    def __init__(self, db: Session):
        self.db = db

    def replace_for_call(self, call_id: int, symptoms: list[Symptom]) -> None:
        self.db.query(Symptom).filter(Symptom.call_id == call_id).delete()
        for symptom in symptoms:
            self.db.add(symptom)
