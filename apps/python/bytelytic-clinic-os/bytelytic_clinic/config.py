"""
Configuration & Environment Settings for Bytelytic Clinic OS
"""
from __future__ import annotations
import os
from dataclasses import dataclass, field
from typing import List


@dataclass
class ClinicConfig:
    calle_api_key: str = field(default_factory=lambda: os.environ.get("CALLE_API_KEY", "calle_mock_key"))
    calle_base_url: str = field(default_factory=lambda: os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com"))
    dry_run: bool = field(default_factory=lambda: os.environ.get("DRY_RUN", "true").lower() in ("1", "true", "yes"))
    app_api_key: str = field(default_factory=lambda: os.environ.get("APP_API_KEY", "bytelytic_demo_key_2026"))
    authorized_recipients: List[str] = field(default_factory=lambda: [
        r.strip() for r in os.environ.get("AUTHORIZED_RECIPIENTS", "+15550192834,+15550192835").split(",") if r.strip()
    ])
    clinic_name: str = field(default_factory=lambda: os.environ.get("CLINIC_NAME", "Oakridge Wellness Clinic"))
    clinic_phone: str = field(default_factory=lambda: os.environ.get("CLINIC_PHONE", "+15550192834"))
    primary_doctor: str = field(default_factory=lambda: os.environ.get("PRIMARY_DOCTOR", "Dr. Demo Specialist, MD"))
    timezone: str = field(default_factory=lambda: os.environ.get("TIMEZONE", "America/Chicago"))


config = ClinicConfig()
