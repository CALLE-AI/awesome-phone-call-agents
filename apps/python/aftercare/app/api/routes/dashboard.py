from app.api.dependencies import get_current_user, get_dashboard_service
from app.models.orm import User
from app.models.schemas import (
    DashboardActivityItem,
    DashboardAttention,
    DashboardOverview,
)
from app.services.dashboard_service import DashboardService, DashboardServiceError
from fastapi import APIRouter, Depends, HTTPException, Query, status

router = APIRouter()


def _raise_dashboard_error(exc: DashboardServiceError) -> None:
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=str(exc),
    ) from exc


@router.get("/overview", response_model=DashboardOverview)
def dashboard_overview(
    days: int = Query(30, description="Chart range in days: 7, 14, 30, or 90"),
    _: User = Depends(get_current_user),
    service: DashboardService = Depends(get_dashboard_service),
):
    try:
        return service.overview(days=days)
    except DashboardServiceError as exc:
        _raise_dashboard_error(exc)


@router.get("/attention", response_model=DashboardAttention)
def dashboard_attention(
    days: int = Query(30, description="Emergency lookback in days: 7, 14, 30, or 90"),
    _: User = Depends(get_current_user),
    service: DashboardService = Depends(get_dashboard_service),
):
    try:
        return service.get_attention(days=days)
    except DashboardServiceError as exc:
        _raise_dashboard_error(exc)


@router.get("/activity", response_model=list[DashboardActivityItem])
def dashboard_activity(
    limit: int = Query(20, ge=1, le=50),
    _: User = Depends(get_current_user),
    service: DashboardService = Depends(get_dashboard_service),
):
    try:
        return service.get_activity(limit=limit)
    except DashboardServiceError as exc:
        _raise_dashboard_error(exc)
