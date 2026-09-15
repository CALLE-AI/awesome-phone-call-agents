from sqlalchemy.orm import Session

from app.models.orm import Patient


class PatientRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, patient_id: int) -> Patient | None:
        return self.db.query(Patient).filter(Patient.id == patient_id).first()

    def list_all(self) -> list[Patient]:
        return self.db.query(Patient).order_by(Patient.id.desc()).all()

    def create(self, patient: Patient) -> Patient:
        self.db.add(patient)
        self.db.commit()
        self.db.refresh(patient)
        return patient

    def save(self, patient: Patient) -> Patient:
        self.db.commit()
        self.db.refresh(patient)
        return patient

    def list_by_risk(self, risk_level: str) -> list[Patient]:
        return (
            self.db.query(Patient)
            .filter(Patient.current_risk_level == risk_level)
            .order_by(Patient.id.desc())
            .all()
        )
