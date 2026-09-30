"""
Top-level client entrypoint forwarder
"""
from bytelytic_clinic.adapters.calle_adapter import CalleAdapter as CalleHealthcareClient
from bytelytic_clinic.domain.schemas import CONFIRMATION_SCHEMA, NO_SHOW_SCHEMA, RECALL_SCHEMA, SURVEY_SCHEMA, PRIOR_AUTH_SCHEMA
from bytelytic_clinic.phone import mask_phone, validate_and_format_e164
