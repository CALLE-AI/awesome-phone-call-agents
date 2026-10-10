"""
Open-Source CRM (Twenty CRM) & n8n Workflow Automation Bridge
Provides multi-tenant routing, webhook event callbacks, and bi-directional CRM syncing.
"""

from __future__ import annotations

import os
import time
import hashlib
import logging
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse
import httpx

from src.models import (
    TenantConfig,
    DispatchLeadRequest,
    DispatchLeadResponse,
    CRMCallbackPayload,
)

logger = logging.getLogger("opscall.crm")


class TenantRegistry:
    """Manages multi-tenant configurations in a single OpsCall deployment."""

    def __init__(self):
        self._tenants: Dict[str, TenantConfig] = {}
        self._seed_default_tenants()

    def _seed_default_tenants(self):
        """Seed pre-built industry tenants for instant client demonstrations."""
        self.register_tenant(
            TenantConfig(
                tenant_id="tenant-ecom-urbanstride",
                client_name="UrbanStride Footwear (Shopify Store)",
                vertical="ecommerce",
                voice_agent_prompt=(
                    "You are the automated order verification concierge for UrbanStride Footwear. "
                    "Confirm the customer's cash-on-delivery order and ask them to press 1 to confirm shipping address."
                ),
                crm_type="twenty",
                crm_endpoint=os.getenv("TWENTY_CRM_URL", "http://localhost:3000/rest"),
            )
        )
        self.register_tenant(
            TenantConfig(
                tenant_id="tenant-clinic-apollocare",
                client_name="ApolloCare Specialist Dental Clinic",
                vertical="clinic",
                voice_agent_prompt=(
                    "You are the appointment coordinator for ApolloCare Clinic. "
                    "Remind the patient of their tomorrow consultation and prompt keypad 1 to confirm attendance."
                ),
                crm_type="twenty",
                crm_endpoint=os.getenv("TWENTY_CRM_URL", "http://localhost:3000/rest"),
            )
        )
        self.register_tenant(
            TenantConfig(
                tenant_id="tenant-b2b-growthscale",
                client_name="GrowthScale B2B Outbound Agency",
                vertical="leadgen",
                voice_agent_prompt=(
                    "You are a sales discovery agent for GrowthScale. "
                    "Verify the prospect's company size and ask if they are open to an exploratory 15-minute chat."
                ),
                crm_type="twenty",
                crm_endpoint=os.getenv("TWENTY_CRM_URL", "http://localhost:3000/rest"),
            )
        )

    def register_tenant(self, config: TenantConfig) -> TenantConfig:
        self._tenants[config.tenant_id] = config
        return config

    def get_tenant(self, tenant_id: str) -> Optional[TenantConfig]:
        return self._tenants.get(tenant_id)

    def list_tenants(self) -> List[TenantConfig]:
        return list(self._tenants.values())


class TwentyCRMConnector:
    """
    Bi-directional sync client for Twenty CRM (open-source CRM).
    Supports REST / GraphQL entity creation and call activity logging.
    """

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None):
        self.base_url = (base_url or os.getenv("TWENTY_CRM_URL", "http://localhost:3000/rest")).strip()
        self.api_key = (api_key or os.getenv("TWENTY_CRM_API_KEY", "")).strip()
        self._validate_credentials_origin()

    def _validate_credentials_origin(self):
        """Restrict provider credentials to approved HTTPS origins; plain HTTP is forbidden except loopback."""
        if not self.base_url:
            return
        parsed = urlparse(self.base_url)
        scheme = (parsed.scheme or "").lower()
        host = (parsed.hostname or "").lower().strip("[]")
        is_loopback = host in ("localhost", "127.0.0.1", "::1")
        if self.api_key and scheme != "https" and not (scheme == "http" and is_loopback):
            raise ValueError(
                f"CRM provider credentials cannot be transmitted over plain HTTP or unapproved origin ({self.base_url}). "
                "Approved HTTPS origin (or local loopback) is required."
            )

    async def log_call_activity(self, payload: CRMCallbackPayload) -> Dict[str, Any]:
        """
        Record completed phone call, DTMF response, and audit hash into Twenty CRM.
        Falls back to resilient local JSON audit trail if remote server is unreachable.
        """
        self._validate_credentials_origin()

        activity_record = {
            "title": f"{'Simulated' if payload.is_simulated else 'Voice Call'}: {payload.callee_name} ({payload.status})",
            "body": (
                f"Outcome: {payload.status}\n"
                f"Verified: {payload.verified}\n"
                f"DTMF Key: {payload.dtmf_key_pressed or 'None'}\n"
                f"Spoken Intent: {payload.spoken_intent}\n"
                f"Summary: {payload.transcript_summary}\n"
                f"Audit Hash: {payload.audit_hash}\n"
                f"Duration: {payload.duration_seconds}s"
            ),
            "phone": payload.callee_phone,
            "timestamp": payload.timestamp,
            "is_simulated": payload.is_simulated
        }

        # Simulation safety gate: Never transmit simulated results to external CRM
        if payload.is_simulated:
            logger.info("Simulated call activity recorded to local audit buffer (external sync disabled).")
            return {"synced": False, "provider": "local_buffer", "simulated": True, "data": activity_record}

        # If Twenty CRM is configured and live with valid origin
        parsed = urlparse(self.base_url)
        scheme = (parsed.scheme or "").lower()
        host = (parsed.hostname or "").lower().strip("[]")
        is_loopback = host in ("localhost", "127.0.0.1", "::1")
        is_https = scheme == "https"
        if self.api_key and (is_https or is_loopback):
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}"
            }
            try:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    resp = await client.post(f"{self.base_url}/activities", json=activity_record, headers=headers)
                    if resp.status_code in (200, 201):
                        logger.info("Successfully synced call activity to Twenty CRM")
                        return {"synced": True, "provider": "twenty", "remote_id": resp.json().get("id")}
            except Exception as e:
                logger.warning("Could not reach Twenty CRM directly, logged to local audit buffer: %s", e)

        return {"synced": False, "provider": "local_buffer", "data": activity_record}


class N8nWebhookDispatcher:
    """Delivers asynchronous call completion events back to n8n workflows."""

    @staticmethod
    async def dispatch_callback(callback_url: str, payload: CRMCallbackPayload) -> bool:
        """Post structured call results back to the initiating n8n workflow."""
        if not callback_url:
            return False

        # Simulation safety gate: Do not transmit simulated payloads to external webhook unless explicit
        if payload.is_simulated:
            logger.info("Skipping external n8n callback for simulated payload (simulation external callbacks disabled).")
            return False

        parsed = urlparse(callback_url)
        scheme = (parsed.scheme or "").lower()
        host = (parsed.hostname or "").lower().strip("[]")
        is_loopback = host in ("localhost", "127.0.0.1", "::1", "n8n.internal")
        if scheme != "https" and not (scheme == "http" and is_loopback):
            logger.warning("Rejected n8n callback to non-HTTPS remote URL: %s", callback_url)
            return False

        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.post(callback_url, json=payload.model_dump())
                return res.status_code in (200, 201, 202, 204)
        except Exception as e:
            logger.warning("Failed to dispatch callback to n8n at %s: %s", callback_url, e)
            return False


# Singleton instances
tenant_registry = TenantRegistry()
twenty_crm = TwentyCRMConnector()
n8n_dispatcher = N8nWebhookDispatcher()
