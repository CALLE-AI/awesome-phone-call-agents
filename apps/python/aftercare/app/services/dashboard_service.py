from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.models.enums import RiskLevel
from app.models.schemas import (
    AttentionEmergencyItem,
    AttentionFollowUpItem,
    AttentionPatientItem,
    DashboardActivityItem,
    DashboardAttention,
    DashboardCharts,
    DashboardOverview,
    DashboardSummary,
    NamedCount,
    RiskCountMap,
    TimeSeriesPoint,
)
from app.repositories.dashboard_repository import DashboardRepository

ALLOWED_RANGE_DAYS = frozenset({7, 14, 30, 90})
RISK_ORDER = (
    RiskLevel.LOW.value,
    RiskLevel.MEDIUM.value,
    RiskLevel.HIGH.value,
    RiskLevel.CRITICAL.value,
)
RISK_LABELS = {
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "critical": "Critical",
    "unknown": "Unknown",
}


class DashboardServiceError(Exception):
    """Domain/service error for dashboard operations."""


class DashboardService:
    def __init__(self, dashboard: DashboardRepository):
        self.dashboard = dashboard

    def overview(self, *, days: int = 30) -> DashboardOverview:
        days = self._validate_days(days)
        now = datetime.now(timezone.utc)
        range_start = self._range_start(now, days)

        summary = self._build_summary(now=now, range_start=range_start)
        charts = self._build_charts(range_start=range_start, days=days, now=now)
        attention = self.get_attention(days=days)
        activity = self.get_activity(limit=20, now=now)

        return DashboardOverview(
            generated_at=now,
            range_days=days,
            summary=summary,
            charts=charts,
            attention=attention,
            recent_activity=activity,
        )

    def get_attention(self, *, days: int = 30) -> DashboardAttention:
        days = self._validate_days(days)
        now = datetime.now(timezone.utc)
        range_start = self._range_start(now, days)

        high_risk = [
            AttentionPatientItem(
                id=p.id,
                name=p.name,
                risk_level=p.current_risk_level or "low",
                protocol_name=p.protocol.name if p.protocol else None,
                needs_followup=bool(p.needs_followup),
            )
            for p in self.dashboard.high_risk_patients(limit=10)
        ]

        overdue = [
            AttentionFollowUpItem(
                id=f.id,
                patient_id=f.patient_id,
                patient_name=f.patient.name if f.patient else "Unknown patient",
                scheduled_time=f.scheduled_time,
                attempt_count=f.attempt_count,
            )
            for f in self.dashboard.overdue_followups(now=self._naive_utc(now), limit=10)
        ]

        emergencies = []
        for call in self.dashboard.recent_emergencies(
            range_start=self._naive_utc(range_start), limit=10
        ):
            # Prefer range filter when call_start set; null starts still allowed by repo
            if call.call_start is not None:
                start = call.call_start
                if start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
                if start < range_start:
                    continue
            emergencies.append(
                AttentionEmergencyItem(
                    id=call.id,
                    patient_id=call.patient_id,
                    patient_name=call.patient.name if call.patient else "Unknown patient",
                    risk_level=call.risk_level,
                    call_start=call.call_start,
                )
            )

        return DashboardAttention(
            high_risk_patients=high_risk,
            overdue_followups=overdue,
            recent_emergencies=emergencies[:10],
        )

    def get_activity(
        self, *, limit: int = 20, now: datetime | None = None
    ) -> list[DashboardActivityItem]:
        if limit < 1 or limit > 50:
            raise DashboardServiceError("limit must be between 1 and 50")
        now = now or datetime.now(timezone.utc)

        items: list[DashboardActivityItem] = []

        for call in self.dashboard.recent_calls(limit=max(limit, 20)):
            patient_name = call.patient.name if call.patient else "Unknown patient"
            occurred = call.call_end or call.call_start
            if occurred is None:
                # Stable fallback ordering by id when timestamps missing
                occurred = datetime(1970, 1, 1) + timedelta(seconds=call.id)

            if call.is_emergency:
                items.append(
                    DashboardActivityItem(
                        id=f"emergency-{call.id}",
                        type="emergency",
                        title=f"Emergency flag — {patient_name}",
                        subtitle=call.status or "emergency",
                        occurred_at=occurred,
                        patient_id=call.patient_id,
                        call_id=call.id,
                        severity=call.risk_level or "critical",
                    )
                )
            elif (call.status or "").lower() == "outcome_unknown":
                items.append(
                    DashboardActivityItem(
                        id=f"call-unknown-{call.id}",
                        type="call_outcome_unknown",
                        title=f"Call needs review — {patient_name}",
                        subtitle="Provider create outcome is unknown",
                        occurred_at=occurred,
                        patient_id=call.patient_id,
                        call_id=call.id,
                        severity=call.risk_level,
                    )
                )
            elif (call.status or "").lower() in {"failed", "canceled", "cancelled"}:
                items.append(
                    DashboardActivityItem(
                        id=f"call-failed-{call.id}",
                        type="call_failed",
                        title=f"Call failed — {patient_name}",
                        subtitle=call.status,
                        occurred_at=occurred,
                        patient_id=call.patient_id,
                        call_id=call.id,
                        severity=call.risk_level,
                    )
                )
            else:
                items.append(
                    DashboardActivityItem(
                        id=f"call-{call.id}",
                        type="call_completed",
                        title=f"Call update — {patient_name}",
                        subtitle=call.status,
                        occurred_at=occurred,
                        patient_id=call.patient_id,
                        call_id=call.id,
                        severity=call.risk_level,
                    )
                )

        for followup in self.dashboard.pending_followups_for_activity(limit=limit):
            patient_name = (
                followup.patient.name if followup.patient else "Unknown patient"
            )
            scheduled = followup.scheduled_time
            scheduled_cmp = scheduled
            if scheduled_cmp.tzinfo is None:
                scheduled_cmp = scheduled_cmp.replace(tzinfo=timezone.utc)
            overdue = scheduled_cmp < now
            items.append(
                DashboardActivityItem(
                    id=f"followup-{followup.id}",
                    type="followup_overdue" if overdue else "followup_pending",
                    title=(
                        f"Overdue follow-up — {patient_name}"
                        if overdue
                        else f"Pending follow-up — {patient_name}"
                    ),
                    subtitle=f"Attempt {followup.attempt_count}/{followup.max_attempts}",
                    occurred_at=scheduled,
                    patient_id=followup.patient_id,
                    followup_id=followup.id,
                    severity="high" if overdue else "medium",
                )
            )

        items.sort(key=lambda item: self._sort_dt(item.occurred_at), reverse=True)
        return items[:limit]

    def _build_summary(
        self, *, now: datetime, range_start: datetime
    ) -> DashboardSummary:
        risk_map = RiskCountMap()
        for level, count in self.dashboard.patients_by_risk_rows():
            key = (level or "low").lower()
            if key in RISK_ORDER:
                setattr(risk_map, key, count)

        naive_now = self._naive_utc(now)
        naive_start = self._naive_utc(range_start)

        return DashboardSummary(
            patients_total=self.dashboard.count_patients(),
            patients_needing_followup=self.dashboard.count_patients_needing_followup(),
            patients_missing_consent=self.dashboard.count_patients_missing_consent(),
            patients_by_risk=risk_map,
            protocols_active=self.dashboard.count_protocols(active_only=True),
            protocols_total=self.dashboard.count_protocols(active_only=False),
            followups_pending=self.dashboard.count_followups_pending(),
            followups_overdue=self.dashboard.count_followups_overdue(now=naive_now),
            calls_in_range=self.dashboard.count_calls_in_range(range_start=naive_start),
            emergencies_in_range=self.dashboard.count_emergencies_in_range(
                range_start=naive_start
            ),
            live_calls_in_range=self.dashboard.count_live_calls_in_range(
                range_start=naive_start
            ),
            dry_run_calls_in_range=self.dashboard.count_dry_run_calls_in_range(
                range_start=naive_start
            ),
        )

    def _build_charts(
        self, *, range_start: datetime, days: int, now: datetime
    ) -> DashboardCharts:
        naive_start = self._naive_utc(range_start)
        end_date = now.date()
        start_date = end_date - timedelta(days=days - 1)

        calls_raw = {
            d: c for d, c in self.dashboard.calls_per_day_rows(range_start=naive_start)
        }
        emergencies_raw = {
            d: c
            for d, c in self.dashboard.emergencies_per_day_rows(range_start=naive_start)
        }

        risk_counts = {k: 0 for k in RISK_ORDER}
        for level, count in self.dashboard.patients_by_risk_rows():
            key = (level or "low").lower()
            if key in risk_counts:
                risk_counts[key] = count

        return DashboardCharts(
            calls_per_day=self._fill_series(start_date, end_date, calls_raw),
            emergencies_per_day=self._fill_series(start_date, end_date, emergencies_raw),
            patients_by_risk=[
                NamedCount(key=k, label=RISK_LABELS[k], count=risk_counts[k])
                for k in RISK_ORDER
            ],
            patients_by_protocol=[
                NamedCount(key=code, label=name, count=count)
                for code, name, count in self.dashboard.patients_by_protocol_rows(
                    limit=10
                )
            ],
            calls_by_status=[
                NamedCount(key=status, label=status.replace("_", " ").title(), count=count)
                for status, count in sorted(
                    self.dashboard.calls_by_status_rows(), key=lambda r: r[0]
                )
            ],
            calls_by_risk=[
                NamedCount(
                    key=level,
                    label=RISK_LABELS.get(level, level.replace("_", " ").title()),
                    count=count,
                )
                for level, count in sorted(
                    self.dashboard.calls_by_risk_rows(),
                    key=lambda r: (
                        RISK_ORDER.index(r[0]) if r[0] in RISK_ORDER else 99,
                        r[0],
                    ),
                )
            ],
            followups_by_status=[
                NamedCount(
                    key=status,
                    label=status.replace("_", " ").title(),
                    count=count,
                )
                for status, count in sorted(
                    self.dashboard.followups_by_status_rows(), key=lambda r: r[0]
                )
            ],
        )

    @staticmethod
    def _validate_days(days: int) -> int:
        if days not in ALLOWED_RANGE_DAYS:
            raise DashboardServiceError("days must be one of 7, 14, 30, or 90")
        return days

    @staticmethod
    def _range_start(now: datetime, days: int) -> datetime:
        start_date = now.date() - timedelta(days=days - 1)
        return datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)

    @staticmethod
    def _naive_utc(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt
        return dt.astimezone(timezone.utc).replace(tzinfo=None)

    @staticmethod
    def _fill_series(
        start: date, end: date, raw: dict[str, int]
    ) -> list[TimeSeriesPoint]:
        points: list[TimeSeriesPoint] = []
        cursor = start
        while cursor <= end:
            key = cursor.isoformat()
            # Postgres date() may return date objects stringified as YYYY-MM-DD
            count = raw.get(key, 0)
            if count == 0:
                # Also try matching keys that might include time remnants
                for rk, rv in raw.items():
                    if str(rk).startswith(key):
                        count = rv
                        break
            points.append(TimeSeriesPoint(date=key, count=count))
            cursor += timedelta(days=1)
        return points

    @staticmethod
    def _sort_dt(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
