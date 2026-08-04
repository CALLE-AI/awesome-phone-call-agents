from pydantic import BaseModel


class EscalationRequest(BaseModel):
    phone: str
    incident: str
    severity: str
