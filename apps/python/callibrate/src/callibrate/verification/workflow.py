"""The whole loop, in one place, in the order it happens.

    claim the task
      -> build the contract from the record
        -> ask the eligibility gate whether this call may happen at all
          -> place the call (CALL-E, or the pilot line)
            -> read the transcript by rule
              -> let the policy decide what that permits
                -> write the record, or the review item, and the ledger entry

Two invariants hold at every step and are the reason the code is shaped this
way.

**A call that fails leaves nothing behind.** Any exception between claiming and
recording releases the task back to the queue with the reason attached. The
record is not touched, no half-written run appears in the ledger, and the next
attempt starts from the same state as this one.

**Nothing skips the gate.** The caller is constructed after eligibility passes,
never before. There is no code path in which CALL-E is asked to plan a call that
the consent rules had already refused.
"""

from __future__ import annotations

import logging
from typing import Any

from callibrate.calling.base import VerificationCaller
from callibrate.calling.calle import CallEVerificationCaller, render_call_goal
from callibrate.calling.mcp import CalleAuth, CalleAuthRequired, CalleMcpClient
from callibrate.calling.models import CallError, CallEvidence
from callibrate.calling.pilot import PilotLineCaller
from callibrate.config import Settings
from callibrate.contracts.models import VerificationContract
from callibrate.policy.evidence_policy import classify, explain, overall
from callibrate.store import Store
from callibrate.verification.triggers import ContractError, build_contract

logger = logging.getLogger("callibrate.verification")


class VerificationWorkflow:
    """Run one verification from a queued task to a written outcome."""

    def __init__(self, store: Store, settings: Settings):
        self.store = store
        self.settings = settings

    # -- caller construction ---------------------------------------------------

    def calle_auth(self) -> CalleAuth:
        return CalleAuth(
            base_url=self.settings.calle_base_url,
            channel=self.settings.calle_channel,
            access_token=self.settings.calle_access_token,
            cache_root=self.settings.calle_cache_root,
        )

    def build_caller(self, call_id: str, *, pilot_scenario: str | None = None) -> VerificationCaller:
        """The caller for this run, chosen by configuration, never by a request.

        `pilot_scenario` only selects which scripted conversation the pilot line
        replays. It cannot turn a live deployment into a scripted one: in
        `calle` mode the pilot line is unreachable.
        """
        if not self.settings.live_calling:
            return PilotLineCaller(pilot_scenario or "hours_changed")
        client = CalleMcpClient(
            self.calle_auth(),
            plan_timeout_seconds=150.0,
        )
        return CallEVerificationCaller(
            client,
            first_poll_seconds=self.settings.calle_first_poll_seconds,
            poll_interval_seconds=self.settings.calle_poll_interval_seconds,
            max_wait_seconds=self.settings.calle_max_wait_seconds,
            ttl_seconds=self.settings.calle_ttl_seconds,
            on_run_started=lambda run_id, plan_id: self.store.attach_calle_run(
                call_id, run_id, plan_id
            ),
        )

    # -- the loop --------------------------------------------------------------

    def contract_for(self, task: dict[str, Any], trigger_message: str = "") -> VerificationContract:
        record = self.store.service_record(task["service_id"])
        service = self.store.service(task["service_id"]) or {}
        return build_contract(
            task,
            record,
            phone=str(service.get("phone") or service.get("organization_phone") or ""),
            timezone=str(service.get("organization_timezone") or "America/New_York"),
            region=self.settings.demo_provider_region,
            trigger_message=trigger_message,
        )

    def preview(self, task_id: str) -> dict[str, Any]:
        """What this call will be, before anybody agrees to place it.

        The rendered goal is returned in full. An instruction that decides
        whether a food bank's opening hours change should be readable by the
        person who owns that directory, not buried in a prompt constant.
        """
        task = self.store.get_task(task_id)
        if not task:
            raise KeyError("task not found")
        contract = self.contract_for(task)
        return {
            "contract": contract.to_payload(),
            "summary": contract.summary(),
            "goal": render_call_goal(contract),
            "caller": "call-e" if self.settings.live_calling else "pilot-line",
            "destination_allowlisted": (
                not self.settings.live_calling
                or contract.authoritative_phone in self.settings.allowlist
            ),
        }

    async def run(
        self,
        task_id: str,
        *,
        actor: str = "callibrate-workflow",
        pilot_scenario: str | None = None,
        trigger_message: str = "",
    ) -> dict[str, Any]:
        """Verify one record end to end. Raises rather than half-writing."""
        task = self.store.claim_task(task_id, actor)
        caller: VerificationCaller | None = None
        call_id = ""
        try:
            if task["do_not_call"]:
                raise ValueError("this organization asked never to be called again")

            contract = self.contract_for(task, trigger_message)
            reservation = self.store.reserve_call(
                task_id,
                contract,
                "call-e" if self.settings.live_calling else "pilot-line",
                allowlist=self.settings.allowlist,
                live=self.settings.live_calling,
                minimum_interval_days=self.settings.minimum_call_interval_days,
            )
            call_id = reservation["call_id"]

            caller = self.build_caller(call_id, pilot_scenario=pilot_scenario)
            evidence: CallEvidence = await caller.verify(contract)

            self.store.update_call_run(
                call_id, "completed", provider_status=evidence.provider_status
            )
            decisions = classify(evidence, contract)
            result = self.store.record_verification(task_id, contract, evidence, decisions, actor)
            result["decisions"] = explain(decisions)
            result["authority"] = overall(decisions).name
            result["evidence"] = evidence.model_dump(mode="json")
            result["contract"] = contract.to_payload()
            return result
        except CalleAuthRequired as error:
            if call_id:
                self.store.update_call_run(call_id, "failed", failure_reason=str(error))
            self.store.release_task(task_id, str(error), actor)
            raise
        except (CallError, ContractError, ValueError, KeyError) as error:
            if call_id:
                self.store.update_call_run(call_id, "failed", failure_reason=str(error))
            self.store.release_task(task_id, str(error), actor)
            raise
        except Exception as error:  # pragma: no cover - defensive
            logger.exception("verification failed for %s", task_id)
            if call_id:
                self.store.update_call_run(call_id, "failed", failure_reason=str(error))
            self.store.release_task(task_id, str(error), actor)
            raise
        finally:
            if caller is not None:
                await caller.aclose()
