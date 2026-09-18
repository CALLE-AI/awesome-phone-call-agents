from __future__ import annotations

import json

from app.api.dependencies import get_webhook_service
from app.api.exceptions import raise_http_from_webhook_error
from app.integrations.calle import event_id_from_headers
from app.models.schemas import CalleWebhookEvent
from app.services.webhook_service import WebhookService, WebhookServiceError
from fastapi import APIRouter, Depends, HTTPException, Request, status

router = APIRouter()


@router.post("/calle", status_code=status.HTTP_200_OK)
async def calle_webhook(
    request: Request,
    service: WebhookService = Depends(get_webhook_service),
):
    """Wake-up only. Clinical side effects use calls.get on the pinned origin."""
    raw_body = await request.body()
    try:
        event_dict = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON webhook body",
        ) from exc

    if not isinstance(event_dict, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON webhook body",
        )

    header_id = event_id_from_headers(dict(request.headers))
    body_id = str(event_dict.get("id") or "").strip()
    if not header_id or not body_id or header_id != body_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="CALL-E-Event-Id must match body id",
        )

    try:
        event = CalleWebhookEvent.model_validate(event_dict)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid webhook event shape",
        ) from exc

    try:
        return service.process_calle_event(
            event_id=event.id,
            event_type=event.type,
            provider_call_id=event.data.id,
        )
    except WebhookServiceError as exc:
        raise_http_from_webhook_error(exc)
