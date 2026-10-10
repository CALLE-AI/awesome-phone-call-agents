import logging
import os
import re
from urllib.parse import urlsplit

import requests

try:
    from calle import CalleClient
except ImportError:
    CalleClient = None

logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
    )

CALLE_API_ENDPOINT = os.environ.get(
    "CALLE_API_ENDPOINT", "https://api.heycall-e.com/v1/calls"
)

ENABLE_OUTBOUND_CALLS = os.environ.get(
    "ENABLE_OUTBOUND_CALLS", "false"
).lower() in ("true", "1", "yes")

APPROVED_CALLE_HOSTS = {
    "api.heycall-e.com",
    "docs.heycall-e.com",
}
custom_hosts = os.environ.get("APPROVED_CALLE_DOMAINS", "")
if custom_hosts:
    APPROVED_CALLE_HOSTS.update(
        [h.strip().lower() for h in custom_hosts.split(",") if h.strip()]
    )

ASCII_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def validate_https_origin(endpoint_url: str) -> str:
    """Restricts credentialed endpoint to approved HTTPS origins only."""
    parsed = urlsplit(endpoint_url)
    if parsed.scheme.lower() != "https":
        raise ValueError(
            f"Insecure endpoint rejected: '{endpoint_url}'. Credentialed endpoints must use HTTPS."
        )
    hostname = (parsed.hostname or "").lower()
    if hostname not in APPROVED_CALLE_HOSTS:
        raise ValueError(
            f"Untrusted origin '{hostname}' rejected. Must be one of approved hosts: {sorted(APPROVED_CALLE_HOSTS)}"
        )
    return endpoint_url


def format_e164(phone: str) -> str:
    """
    Validates and formats recipient phone number strictly into ASCII E.164 (+[1-9]\\d{6,14}).
    Rejects empty, non-ASCII, or invalid telephone structures.
    """
    if not phone or not isinstance(phone, str) or not phone.isascii():
        raise ValueError(
            f"Phone number must be a non-empty ASCII string. Received: {repr(phone)}"
        )
    digits_only = re.sub(r"[\s\-\(\)\.]", "", phone.strip())
    if not digits_only.startswith("+"):
        digits_only = f"+{digits_only}"
    if not ASCII_E164_RE.match(digits_only):
        raise ValueError(
            f"Phone number '{phone}' cannot be formatted into a valid ASCII E.164 recipient standard."
        )
    return digits_only


def is_authorized_recipient(phone: str) -> bool:
    """
    Ensures recipient is an explicitly authorized ASCII E.164 number.
    By default permits fictional reservation range (+15550100 to +15550199)
    or numbers explicitly listed in AUTHORIZED_RECIPIENT_PHONES.
    """
    try:
        canonical = format_e164(phone)
    except ValueError:
        return False

    if canonical.startswith("+155501"):
        return True

    env_authorized = [
        p.strip()
        for p in os.environ.get("AUTHORIZED_RECIPIENT_PHONES", "").split(",")
        if p.strip()
    ]
    return canonical in env_authorized


def mask_phone_number(phone: str) -> str:
    """Masks phone number for safety and privacy rules (+15550199 -> +1••••••0199)."""
    if not phone:
        return "+1••••••0199"
    s = str(phone).strip()
    if len(s) <= 5:
        return "••••••••"
    return f"{s[:3]}••••••{s[-4:]}"


class CallEVoiceService:
    def __init__(self):
        self.api_key = os.environ.get("CALLE_API_KEY")
        logger.info(
            f"[Call-E Service] Endpoint: '{CALLE_API_ENDPOINT}'. Outbound Calls Enabled: {ENABLE_OUTBOUND_CALLS}. SDK Available: {CalleClient is not None}"
        )

    def call_on_call_engineer(self, result_schema: dict) -> dict:
        """
        Calls on-call engineer using Call-E Python SDK (https://docs.heycall-e.com/calls).
        Enforces:
        - Default to no-call (sandbox/fake mode unless ENABLE_OUTBOUND_CALLS=true)
        - Explicit authorized ASCII E.164 recipient validation
        - Approved HTTPS origin checking
        - Rejection of HTTP redirects
        - Bound approval (no fabrication upon error or timeout)
        """
        engineer = result_schema.get("oncall_engineer", {})
        eng_name = engineer.get("name", "Alex Morgan")
        raw_phone = engineer.get("phone", "+15550199")

        error_context = result_schema.get("error_context", {})
        dag_id = error_context.get("dag_id", "retail_inventory_etl")
        task_id = error_context.get("task_id", "transform_inventory_sql")
        incident_id = result_schema.get("incident_id")

        # 1. Validate ASCII E.164 format
        try:
            phone = format_e164(raw_phone)
        except ValueError as e:
            logger.error(f"❌ [Call-E Safety Violation] Invalid recipient phone '{raw_phone}': {e}")
            return {
                "approved": False,
                "user_id_validated": False,
                "status": "INVALID_RECIPIENT",
                "error": str(e),
                "dag_id": dag_id,
                "task_id": task_id,
                "incident_id": incident_id,
                "is_sandbox": not ENABLE_OUTBOUND_CALLS,
            }

        locale = engineer.get("locale", "en-US")
        region = engineer.get("region", "US")
        user_id = engineer.get("userid") or engineer.get("user_id", "a7m9x1")

        error_msg = error_context.get("error_message", "")
        playbook = result_schema.get("playbook_details", {})
        jira = result_schema.get("jira_history", [])

        playbook_fix = playbook.get("recommended_sql", "No automatic match.")
        jira_ref = jira[0].get("key") if jira else "None"

        prompt_text = (
            f"Hello {eng_name}. Urgent incident alert from Apache Airflow.\n"
            f"SECURITY STEP 1: Before authorizing any remediation steps, please state and verify your Employee User ID (Expected: '{user_id}').\n"
            f"Friday Night Retail Inventory ETL DAG ({dag_id}) failed at task '{task_id}'.\n"
            f"Error: {error_msg}.\n"
            f"Playbook match ({playbook.get('id', 'N/A')}): {playbook.get('title', 'N/A')}.\n"
            f"Jira historical match: {jira_ref}.\n"
            f"Suggested SQL Fix: {playbook_fix}\n"
            f"Once User ID '{user_id}' is validated, please state if you approve the SQL fix and provide step-by-step resolution instructions."
        )

        incident_result_schema = {
            "type": "object",
            "required": ["user_id_validated", "approved", "resolution_instructions", "evidence_summary"],
            "properties": {
                "user_id_validated": {
                    "type": "boolean",
                    "description": f"Whether the engineer successfully stated and verified their employee User ID ('{user_id}'). Must be True before approval.",
                },
                "approved": {
                    "type": "string",
                    "enum": ["yes", "no", "unknown"],
                    "description": f"Whether the authenticated engineer (User ID '{user_id}') explicitly approved running the recommended SQL remediation steps. Use yes when approved and user_id_validated is True, no when declined, and unknown if unconfirmed or user_id invalid.",
                },
                "resolution_instructions": {
                    "type": "string",
                    "description": "The exact SQL query or step-by-step resolution instructions provided by the engineer.",
                },
                "evidence_summary": {
                    "type": "string",
                    "description": "One concise sentence summarizing the engineer's User ID validation and response.",
                },
            },
            "additionalProperties": False,
        }

        call_payload = {
            "task": prompt_text,
            "recipients": [{"phones": [phone], "locale": locale, "region": region}],
            "result_schema": incident_result_schema,
            "metadata": {
                "agent_id": "call_e_incident_response_agent",
                "incident_id": incident_id,
            },
        }

        logger.info("\n" + "=" * 75)
        logger.info(
            f"📞 [CALL-E VOICE AI] Recipient: {eng_name} ({mask_phone_number(phone)}) | Outbound Enabled: {ENABLE_OUTBOUND_CALLS}"
        )
        logger.info("=" * 75)

        # 2. DEFAULT TO NO-CALL (Local Sandbox Operation)
        if not ENABLE_OUTBOUND_CALLS:
            logger.info(
                f"[Call-E Voice AI] Sandbox operation active (ENABLE_OUTBOUND_CALLS=false). Simulating local authorized response for fixture {eng_name}."
            )
            logger.info(
                f"🔐 [Call-E Security Validation] Verification Step: On-Call Engineer {eng_name} provided User ID '{user_id}'."
            )
            logger.info(
                f"🗣️ [{eng_name} via Call-E Voice AI Sandbox]: 'User ID {user_id} verified. Approved. Please run: ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT \'OK\'; then validate data.'"
            )
            logger.info("=" * 75 + "\n")

            return {
                "approved": True,
                "user_id_validated": True,
                "user_id": user_id,
                "engineer_name": eng_name,
                "engineer_phone": phone,
                "resolution_instructions": "ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';",
                "dag_id": dag_id,
                "task_id": task_id,
                "incident_id": incident_id,
                "is_sandbox": True,
                "status": "APPROVED",
            }

        # 3. LIVE CALL DISPATCH PATH
        if not is_authorized_recipient(phone):
            logger.error(
                f"❌ [Call-E Safety Violation] Recipient '{mask_phone_number(phone)}' is not in authorized recipients list."
            )
            return {
                "approved": False,
                "user_id_validated": False,
                "status": "UNAUTHORIZED_RECIPIENT",
                "error": f"Recipient '{mask_phone_number(phone)}' is not in authorized recipient whitelist.",
                "dag_id": dag_id,
                "task_id": task_id,
                "incident_id": incident_id,
                "is_sandbox": False,
            }

        if not self.api_key:
            logger.error("❌ [Call-E Configuration] ENABLE_OUTBOUND_CALLS=true but CALLE_API_KEY is not set.")
            return {
                "approved": False,
                "user_id_validated": False,
                "status": "MISSING_CREDENTIALS",
                "error": "CALLE_API_KEY required for live outbound call dispatch.",
                "dag_id": dag_id,
                "task_id": task_id,
                "incident_id": incident_id,
                "is_sandbox": False,
            }

        try:
            validated_endpoint = validate_https_origin(CALLE_API_ENDPOINT)
            parsed = urlsplit(validated_endpoint)
            base_url = f"https://{parsed.netloc}"

            if CalleClient is not None:
                client = CalleClient(api_key=self.api_key, base_url=base_url)
                created_call = client.calls.create(
                    task=prompt_text,
                    recipients=[
                        {"phones": [phone], "locale": locale, "region": region}
                    ],
                    result_schema=incident_result_schema,
                    metadata={
                        "agent_id": "call_e_incident_response_agent",
                        "incident_id": incident_id,
                    },
                )
                call_id = (
                    created_call.get("id")
                    if isinstance(created_call, dict)
                    else getattr(created_call, "id", str(created_call))
                )
                logger.info(f"[Call-E SDK] Call created: id={call_id}")
                if not call_id:
                    return {
                        "approved": False,
                        "user_id_validated": False,
                        "status": "CREATION_FAILED",
                        "error": "Call creation did not return a call ID",
                        "dag_id": dag_id,
                        "task_id": task_id,
                        "incident_id": incident_id,
                        "is_sandbox": False,
                    }

                logger.info(f"[Call-E SDK] Waiting for call '{call_id}' to complete...")
                completed_call = client.calls.wait_for_result(
                    call_id, timeout_seconds=300, interval_seconds=10
                )
                if not completed_call or not isinstance(completed_call, dict):
                    return {
                        "approved": False,
                        "user_id_validated": False,
                        "status": "TIMED_OUT",
                        "error": "Call did not return a valid result dictionary.",
                        "dag_id": dag_id,
                        "task_id": task_id,
                        "incident_id": incident_id,
                        "is_sandbox": False,
                    }

                call_status = completed_call.get("status")
                if call_status != "completed":
                    logger.warning(
                        f"[Call-E SDK] Call '{call_id}' finished with non-completed status: {call_status}"
                    )
                    return {
                        "approved": False,
                        "user_id_validated": False,
                        "status": call_status or "FAILED",
                        "error": f"Call ended with status '{call_status}'",
                        "dag_id": dag_id,
                        "task_id": task_id,
                        "incident_id": incident_id,
                        "is_sandbox": False,
                    }

                res_data = completed_call.get("result") or completed_call.get("result_schema") or {}
                uid_validated = bool(res_data.get("user_id_validated") is True)
                app_val = str(res_data.get("approved", "")).lower()
                is_approved = uid_validated and (app_val in ("yes", "true"))
                instructions = res_data.get("resolution_instructions", "")

                return {
                    "approved": is_approved,
                    "user_id_validated": uid_validated,
                    "user_id": user_id if uid_validated else None,
                    "engineer_name": eng_name,
                    "engineer_phone": phone,
                    "resolution_instructions": instructions if is_approved else "",
                    "status": "APPROVED" if is_approved else "REJECTED_OR_UNCONFIRMED",
                    "evidence_summary": res_data.get("evidence_summary", ""),
                    "dag_id": dag_id,
                    "task_id": task_id,
                    "incident_id": incident_id,
                    "is_sandbox": False,
                }

            else:
                # REST API fallback with strict redirect rejection
                response = requests.post(
                    validated_endpoint,
                    json=call_payload,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=10,
                    allow_redirects=False,
                )
                if response.is_redirect or response.status_code in [301, 302, 303, 307, 308]:
                    raise ValueError(
                        f"HTTP Redirect rejected for credentialed Call-E endpoint: HTTP {response.status_code}"
                    )

                if response.status_code not in [200, 201, 202]:
                    logger.error(
                        f"[Call-E API] Request returned HTTP {response.status_code}: {response.text}"
                    )
                    return {
                        "approved": False,
                        "user_id_validated": False,
                        "status": f"HTTP_{response.status_code}",
                        "error": response.text,
                        "dag_id": dag_id,
                        "task_id": task_id,
                        "incident_id": incident_id,
                        "is_sandbox": False,
                    }

                resp_data = response.json() if response.text else {}
                call_id = resp_data.get("id")
                if not call_id:
                    return {
                        "approved": False,
                        "user_id_validated": False,
                        "status": "NO_CALL_ID",
                        "error": "No call ID returned in REST response",
                        "dag_id": dag_id,
                        "task_id": task_id,
                        "incident_id": incident_id,
                        "is_sandbox": False,
                    }

                # Poll status with redirect rejection
                import time

                deadline = time.time() + 120
                final_res = None
                while time.time() < deadline:
                    poll_res = requests.get(
                        f"{base_url}/v1/calls/{call_id}",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        timeout=10,
                        allow_redirects=False,
                    )
                    if poll_res.is_redirect or poll_res.status_code in [301, 302, 303, 307, 308]:
                        raise ValueError(f"HTTP Redirect rejected in polling: HTTP {poll_res.status_code}")
                    if poll_res.status_code == 200:
                        p_data = poll_res.json()
                        p_status = p_data.get("status")
                        if p_status in ["completed", "failed", "canceled"]:
                            final_res = p_data
                            break
                    time.sleep(2)

                if not final_res or final_res.get("status") != "completed":
                    term_status = (final_res.get("status") if final_res else "TIMED_OUT") or "FAILED"
                    return {
                        "approved": False,
                        "user_id_validated": False,
                        "status": term_status,
                        "error": f"Call ended with terminal status: {term_status}",
                        "dag_id": dag_id,
                        "task_id": task_id,
                        "incident_id": incident_id,
                        "is_sandbox": False,
                    }

                r_data = final_res.get("result") or final_res.get("result_schema") or {}
                uid_validated = bool(r_data.get("user_id_validated") is True)
                app_val = str(r_data.get("approved", "")).lower()
                is_approved = uid_validated and (app_val in ("yes", "true"))
                return {
                    "approved": is_approved,
                    "user_id_validated": uid_validated,
                    "user_id": user_id if uid_validated else None,
                    "engineer_name": eng_name,
                    "engineer_phone": phone,
                    "resolution_instructions": r_data.get("resolution_instructions", "") if is_approved else "",
                    "status": "APPROVED" if is_approved else "REJECTED_OR_UNCONFIRMED",
                    "dag_id": dag_id,
                    "task_id": task_id,
                    "incident_id": incident_id,
                    "is_sandbox": False,
                }

        except Exception as e:
            logger.error(f"❌ [Call-E Outbound Error] Failed to complete live call: {e}")
            return {
                "approved": False,
                "user_id_validated": False,
                "status": "ERROR",
                "error": str(e),
                "dag_id": dag_id,
                "task_id": task_id,
                "incident_id": incident_id,
                "is_sandbox": False,
            }

    def call_post_validation(
        self,
        engineer_info: dict,
        dag_id: str,
        task_id: str,
        success: bool,
        zoom_bridge_url: str = None,
    ):
        """
        Calls on-call engineer post-remediation using Call-E Python SDK.
        If solved: informs that steps solved the issue.
        If not solved: informs failure and requests joining Zoom bridge.
        """
        eng_name = engineer_info.get("name", "Alex Morgan")
        raw_phone = engineer_info.get("phone", "+15550199")

        try:
            phone = format_e164(raw_phone)
        except ValueError as e:
            logger.error(f"[Call-E Service] Post-validation phone validation failed: {e}")
            return

        logger.info("\n" + "=" * 75)
        logger.info(
            f"📞 [CALL-E FOLLOW-UP CALL] Target: {eng_name} ({mask_phone_number(phone)}) | Outbound Enabled: {ENABLE_OUTBOUND_CALLS}"
        )
        logger.info("=" * 75)

        if success:
            script = (
                f"Voice Agent: 'Hi {eng_name}, Call-E here with confirmation!\n"
                f"The resolution steps you provided have successfully solved the error in DAG '{dag_id}', task '{task_id}'.\n"
                f"Data load is 100% validated and green for Monday morning operations! Thank you.'"
            )
        else:
            zoom_url = (
                zoom_bridge_url or "https://zoom.us/j/9876543210?pwd=INCIDENT_BRIDGE"
            )
            script = (
                f"Voice Agent: 'ALERT {eng_name}! The steps provided did NOT resolve the error in DAG '{dag_id}'.\n"
                f"Data validation failed. Please join the emergency Zoom bridge immediately: {zoom_url}'"
            )

        if not ENABLE_OUTBOUND_CALLS or not self.api_key:
            logger.info(
                f"[Call-E Voice AI] Sandbox/Fake-only mode active. Skipping live follow-up outbound call to {eng_name} ({mask_phone_number(phone)})."
            )
            logger.info(script)
            logger.info("=" * 75 + "\n")
            return

        if not is_authorized_recipient(phone):
            logger.error(
                f"[Call-E Safety Violation] Recipient '{mask_phone_number(phone)}' is not an authorized recipient."
            )
            return

        try:
            validated_endpoint = validate_https_origin(CALLE_API_ENDPOINT)
            parsed = urlsplit(validated_endpoint)
            base_url = f"https://{parsed.netloc}"

            followup_schema = {
                "type": "object",
                "required": ["acknowledged", "evidence_summary"],
                "properties": {
                    "acknowledged": {
                        "type": "string",
                        "enum": ["yes", "no", "unknown"],
                        "description": "Whether the engineer acknowledged the post-validation status update.",
                    },
                    "evidence_summary": {
                        "type": "string",
                        "description": "One concise sentence summarizing the engineer's response to the follow-up.",
                    },
                },
                "additionalProperties": False,
            }

            if CalleClient is not None:
                client = CalleClient(api_key=self.api_key, base_url=base_url)
                created_call = client.calls.create(
                    task=script,
                    recipients=[
                        {
                            "phones": [phone],
                            "locale": engineer_info.get("locale", "en-US"),
                            "region": engineer_info.get("region", "US"),
                        }
                    ],
                    result_schema=followup_schema,
                    metadata={"dag_id": dag_id, "success": success},
                )
                call_id = (
                    created_call.get("id")
                    if isinstance(created_call, dict)
                    else getattr(created_call, "id", str(created_call))
                )
                logger.info(f"[Call-E SDK] Follow-up call created: id={call_id}")
                if call_id:
                    client.calls.wait_for_result(
                        call_id, timeout_seconds=120, interval_seconds=5
                    )
            else:
                response = requests.post(
                    validated_endpoint,
                    json={
                        "task": script,
                        "recipients": [
                            {
                                "phones": [phone],
                                "locale": engineer_info.get("locale", "en-US"),
                                "region": engineer_info.get("region", "US"),
                            }
                        ],
                        "result_schema": followup_schema,
                        "metadata": {"dag_id": dag_id, "success": success},
                    },
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=10,
                    allow_redirects=False,
                )
                if response.is_redirect or response.status_code in [301, 302, 303, 307, 308]:
                    raise ValueError(f"HTTP Redirect rejected in follow-up call: {response.status_code}")
        except Exception as e:
            logger.warning(f"[Call-E API/SDK] Follow-up call warning: {e}")

        logger.info(script)
        logger.info("=" * 75 + "\n")
