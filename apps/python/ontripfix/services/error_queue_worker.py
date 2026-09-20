import queue
import threading
import time
import uuid
import datetime
import logging
from services.jira_service import (
    search_jira,
    create_jira_ticket,
    add_jira_comment,
    update_jira_ticket_status,
)

from services.confluence_service import (
    fetch_confluence_playbook,
    get_ontripfix_on_call_engineer,
)
from services.calle_voice_service import (
    CallEVoiceService,
    mask_phone_number,
)

logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
    )

error_queue = queue.Queue()
calle_service = CallEVoiceService()


from db.telemetry_db import (
    log_incident_create,
    log_incident_update,
    log_queue_action,
    log_service_event,
    log_step,
)


def enqueue_error_payload(payload: dict):
    """Pushes a DAG failure payload onto the Error Queue and logs telemetry."""
    incident_id = f"INC-{uuid.uuid4().hex[:6].upper()}"
    payload["incident_id"] = incident_id
    dag_id = payload.get("dag_id", "retail_inventory_etl")
    task_id = payload.get("task_id", "transform_inventory_sql")
    error_msg = payload.get("error_message", "")
    exception_str = payload.get("exception")

    # Create Jira ticket for newly arrived incident
    jira_ticket = create_jira_ticket(
        incident_id=incident_id,
        dag_id=dag_id,
        task_id=task_id,
        error_message=error_msg,
        exception=exception_str,
    )
    payload["jira_ticket"] = jira_ticket
    jira_key = jira_ticket.get("key")

    # Create incident record in Telemetry DB
    log_incident_create(incident_id, dag_id, task_id, error_msg)
    log_queue_action("ERROR_QUEUE", incident_id, "ENQUEUED", payload)
    log_service_event(
        incident_id,
        "JIRA",
        "JIRA_TICKET_CREATED",
        "SUCCESS",
        f"Created Jira ticket {jira_key} in project '{jira_ticket.get('project')}'",
        {"jira_ticket": jira_ticket},
    )

    if jira_key:
        add_jira_comment(
            jira_key,
            f"📥 Incident enqueued onto Error Queue for DAG '{dag_id}' (Task: '{task_id}'). Error: {error_msg}",
        )

    logger.info(
        f"📥 [Error Queue] Enqueued incident '{incident_id}' for DAG '{dag_id}'. Jira ticket '{jira_key}' created in project '{jira_ticket.get('project')}'."
    )
    error_queue.put(payload)
    return incident_id


def process_error_queue(resolution_queue_push_func):
    """Worker loop to process incidents from the Error Queue."""
    while True:
        try:
            payload = error_queue.get(timeout=1)
        except queue.Empty:
            time.sleep(0.5)
            continue

        incident_id = payload.get("incident_id")
        jira_ticket = payload.get("jira_ticket") or {}
        jira_key = jira_ticket.get("key")

        log_queue_action("ERROR_QUEUE", incident_id, "DEQUEUED", payload)
        logger.info("\n" + "=" * 75)
        logger.info(f"⚙️ [Error Queue Worker] Processing Incident '{incident_id}'...")
        logger.info("=" * 75)

        error_msg = payload.get("error_message", "")
        dag_id = payload.get("dag_id", "retail_inventory_etl")
        task_id = payload.get("task_id", "transform_inventory_sql")

        # 1. Search Jira API (or env check fallback)
        jira_history = search_jira(error_msg)
        log_service_event(
            incident_id,
            "JIRA",
            "JIRA_SEARCH",
            "INFO",
            f"Searched Jira for error pattern. Found {len(jira_history)} ticket(s).",
            {"tickets": jira_history},
        )

        # 2. Search Confluence Playbook / Local Playbook / AI Diagnosis Graph
        playbook = fetch_confluence_playbook(error_msg, dag_id=dag_id, task_id=task_id)
        pb_source = playbook.get("source", "unknown")
        log_service_event(
            incident_id,
            "CONFLUENCE" if "confluence" in pb_source else "LANGGRAPH",
            "PLAYBOOK_LOOKUP",
            "SUCCESS",
            f"Runbook matched via {pb_source}: {playbook.get('title')}",
            {"playbook": playbook},
        )

        if jira_key:
            add_jira_comment(
                jira_key,
                f"📖 Runbook matched via {pb_source}: '{playbook.get('title')}'. Recommended SQL patch: `{playbook.get('recommended_sql')}`",
            )

        # 3. Get On-Call Engineer from Confluence Calendar (or local config fallback)
        oncall_data = get_ontripfix_on_call_engineer()
        engineer = oncall_data["engineer"]
        log_service_event(
            incident_id,
            "CONFLUENCE",
            "ROSTER_CHECK",
            "INFO",
            f"On-call engineer retrieved: {engineer.get('name')} ({mask_phone_number(engineer.get('phone'))})",
            {"engineer": engineer},
        )

        if jira_key:
            add_jira_comment(
                jira_key,
                f"👤 Assigned On-Call Engineer: {engineer.get('name')} ({mask_phone_number(engineer.get('phone'))}). Shift: {oncall_data.get('shift_name', 'OnTripFix On-Call Shift')}",
            )

        # Format standardized resultSchema
        result_schema = {
            "incident_id": incident_id,
            "created_at": datetime.datetime.now().isoformat(),
            "error_context": payload,
            "jira_history": jira_history,
            "playbook_details": playbook,
            "oncall_engineer": engineer,
            "shift_info": oncall_data.get("shift_name", "OnTripFix On-Call Shift"),
        }

        # Update telemetry incident record
        log_incident_update(
            incident_id,
            {
                "engineer_name": engineer.get("name"),
                "engineer_phone": engineer.get("phone"),
                "recommended_sql": playbook.get("recommended_sql"),
                "playbook_source": pb_source,
                "status": "CALLING_ENGINEER",
            },
        )

        log_step(
            incident_id,
            2,
            "Telemetry & Runbook Discovery",
            "SUCCESS",
            f"Jira matched {len(jira_history)} ticket(s). Runbook ({pb_source}): '{playbook.get('title')}'. Engineer: {engineer.get('name')}",
        )

        logger.info(
            f"📋 [Error Queue Worker] Formatted resultSchema for '{incident_id}':"
        )
        logger.info(
            f"   On-Call Engineer: {engineer['name']} ({mask_phone_number(engineer['phone'])}) ({engineer.get('locale')}) ({engineer.get('region')})"
        )
        logger.info(f"   Source Roster: {engineer.get('source')}")
        logger.info(f"   Jira History: {len(jira_history)} ticket(s)")
        logger.info(f"   Playbook Match: {playbook.get('title')}")

        # 4. Initiate Call-E Outbound Call to On-Call Engineer & Transition Jira to "In Progress"
        if jira_key:
            update_jira_ticket_status(jira_key, "In Progress")
            add_jira_comment(
                jira_key,
                f"📞 Placed Call-E Outbound Voice AI contact call to {engineer.get('name')} for remediation authorization. Status transitioned to IN PROGRESS.",
            )


        log_service_event(
            incident_id,
            "CALLE_VOICE",
            "OUTBOUND_CALL_INITIATED",
            "INFO",
            f"Initiated Call-E Voice AI call to {engineer.get('name')} ({mask_phone_number(engineer.get('phone'))})",
            {"result_schema": result_schema},
        )
        log_step(
            incident_id,
            3,
            "Call-E Outbound Voice AI Contact",
            "SUCCESS",
            f"Placed voice call to on-call engineer {engineer.get('name')}. Suggested fix: {playbook.get('recommended_sql')}",
        )

        resolution_response = calle_service.call_on_call_engineer(result_schema)
        resolution_response["result_schema"] = result_schema
        user_id_val = bool(resolution_response.get("user_id_validated") is True)
        is_approved = user_id_val and (resolution_response.get("approved") in (True, "yes"))
        user_id_str = resolution_response.get(
            "user_id", engineer.get("userid") or engineer.get("user_id", "a7m9x1")
        )

        if not is_approved:
            reason = (
                resolution_response.get("error")
                or resolution_response.get("status")
                or "Remediation unconfirmed or declined by on-call engineer."
            )
            logger.warning(
                f"🛑 [Incident Escalation] Halting automatic remediation for '{incident_id}'. Bound approval failed: approved={resolution_response.get('approved')}, user_id_validated={user_id_val}. Reason: {reason}"
            )
            log_incident_update(incident_id, {"status": "AWAITING_MANUAL_INTERVENTION"})
            log_step(
                incident_id,
                4,
                "Remediation Authorization Halt",
                "FAILED",
                f"Automatic remediation blocked: User ID validated={user_id_val}, Approved={resolution_response.get('approved')}. Reason: {reason}",
            )
            log_service_event(
                incident_id,
                "CALLE_VOICE",
                "REMEDIATION_BLOCKED",
                "WARNING",
                f"Remediation halted without explicit bound approval. Reason: {reason}",
                {"resolution": resolution_response},
            )
            if jira_key:
                add_jira_comment(
                    jira_key,
                    f"⚠️ AUTOMATIC REMEDIATION BLOCKED: On-Call contact did not yield explicit authenticated approval.\n"
                    f"- User ID Validated: {user_id_val}\n"
                    f"- Approval Status: {resolution_response.get('approved')}\n"
                    f"- Reason: {reason}\n"
                    f"Ticket remains IN PROGRESS awaiting human manual triage.",
                )
            log_queue_action("ERROR_QUEUE", incident_id, "STOPPED_UNAPPROVED", payload)
            error_queue.task_done()
            continue

        if jira_key:
            add_jira_comment(
                jira_key,
                f"🔐 User ID Security Verification: Engineer {engineer.get('name')} provided User ID '{user_id_str}' (Validated: {user_id_val}).\n✅ Voice AI call completed. Engineer approved remediation: {resolution_response.get('approved')}.",
            )

        log_service_event(
            incident_id,
            "CALLE_VOICE",
            "OUTBOUND_CALL_COMPLETED",
            "SUCCESS",
            f"Call completed. Engineer User ID '{user_id_str}' validated: {user_id_val}. Remediation approved: {resolution_response.get('approved')}",
            {"resolution": resolution_response},
        )

        # 5. Push resolution payload to Resolution Queue
        log_queue_action("ERROR_QUEUE", incident_id, "PROCESSED", payload)
        resolution_queue_push_func(resolution_response)

        error_queue.task_done()
