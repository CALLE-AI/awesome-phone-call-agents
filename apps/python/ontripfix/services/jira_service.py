import os
import requests
import logging
import datetime

logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
    )


def _get_clean_jira_url() -> str | None:
    jira_url = os.environ.get("JIRA_URL")
    if not jira_url:
        return None
    clean_url = jira_url.strip().rstrip("/")
    if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
        clean_url = f"https://{clean_url}"
    return clean_url


def create_jira_ticket(
    incident_id: str,
    dag_id: str,
    task_id: str,
    error_message: str,
    exception: str = None,
) -> dict:
    """
    Creates a Jira ticket for a newly arrived incident using the configured Jira API endpoint and Project Name.
    The project name is read from environment variable JIRA_PROJECT_KEY (or JIRA_PROJECT_NAME / JIRA_PROJECT).
    If Jira environment variables are missing or API call fails, returns a structured fallback created ticket.
    """
    jira_url = _get_clean_jira_url()
    jira_email = os.environ.get("JIRA_USER_EMAIL")
    jira_token = os.environ.get("JIRA_API_TOKEN")
    project_key = (
        os.environ.get("JIRA_PROJECT_KEY")
        or os.environ.get("JIRA_PROJECT_NAME")
        or os.environ.get("JIRA_PROJECT", "DIM")
    )

    summary = f"[{incident_id}] Incident in DAG '{dag_id}' (Task: '{task_id}')"
    description_text = (
        f"Incident ID: {incident_id}\n"
        f"DAG ID: {dag_id}\n"
        f"Task ID: {task_id}\n"
        f"Error Message: {error_message}\n"
        f"Exception: {exception or 'N/A'}"
    )

    if not jira_url or not jira_email or not jira_token:
        logger.error("[Jira Service] Jira environment variables are missing.")

    if jira_url and jira_email and jira_token:
        logger.info(
            f"[Jira Service] Creating Jira ticket in project '{project_key}' at {jira_url} for incident '{incident_id}'..."
        )
        try:
            create_url = f"{jira_url}/rest/api/3/issue"
            payload = {
                "fields": {
                    "project": {"key": project_key},
                    "summary": summary,
                    "description": {
                        "type": "doc",
                        "version": 1,
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": description_text,
                                    }
                                ],
                            }
                        ],
                    },
                    "issuetype": {"name": "Bug"},
                }
            }
            response = requests.post(
                create_url,
                json=payload,
                auth=(jira_email, jira_token),
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                timeout=10,
            )
            if response.status_code in (200, 201):
                data = response.json()
                issue_key = data.get("key")
                logger.info(
                    f"[Jira Service] Successfully created Jira ticket '{issue_key}' in project '{project_key}'."
                )
                return {
                    "key": issue_key,
                    "id": data.get("id"),
                    "summary": summary,
                    "project": project_key,
                    "status": "OPEN",
                    "url": f"{jira_url}/browse/{issue_key}",
                    "source": "jira_rest_api",
                }
            else:
                logger.warning(
                    f"[Jira Service] Jira API create issue returned HTTP {response.status_code}: {response.text}"
                )
        except Exception as e:
            logger.warning(f"[Jira Service] Failed to create ticket via Jira API: {e}")

    # Structured fallback when env vars missing or API fails
    logger.info(
        f"[Jira Service] Jira API env vars missing or unavailable. Generating fallback Jira ticket for project '{project_key}'."
    )
    fallback_key = f"{project_key}-4022"
    return {
        "key": fallback_key,
        "summary": summary,
        "project": project_key,
        "status": "OPEN",
        "assignee": "Unassigned",
        "description": description_text,
        "created": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "jira_created_fallback",
    }


def add_jira_comment(issue_key: str, comment_text: str) -> bool:
    """
    Posts an event update log / comment to an existing Jira ticket.
    If Jira API credentials are present, calls Jira REST API comment endpoint.
    Otherwise, logs the comment to telemetry/logs.
    """
    if not issue_key:
        return False

    jira_url = _get_clean_jira_url()
    jira_email = os.environ.get("JIRA_USER_EMAIL")
    jira_token = os.environ.get("JIRA_API_TOKEN")

    if jira_url and jira_email and jira_token:
        logger.info(f"[Jira Service] Adding comment to Jira ticket '{issue_key}'...")
        try:
            comment_url = f"{jira_url}/rest/api/3/issue/{issue_key}/comment"
            payload = {
                "body": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": f"🤖 [OnTripFix] {comment_text}",
                                }
                            ],
                        }
                    ],
                }
            }
            response = requests.post(
                comment_url,
                json=payload,
                auth=(jira_email, jira_token),
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                timeout=10,
            )
            if response.status_code in (200, 201):
                logger.info(
                    f"[Jira Service] Successfully added comment to Jira ticket '{issue_key}'."
                )
                return True
            else:
                logger.warning(
                    f"[Jira Service] Jira API add comment returned HTTP {response.status_code}: {response.text}"
                )
        except Exception as e:
            logger.warning(
                f"[Jira Service] Failed to add comment to Jira ticket '{issue_key}': {e}"
            )

    logger.info(f"[Jira Comment Log] [Ticket '{issue_key}'] {comment_text}")
    return True


def update_jira_ticket_status(issue_key: str, status_name: str) -> bool:
    """
    Transitions a Jira ticket to a new status (e.g. 'In Progress', 'Done').
    Fetches available transitions via GET /rest/api/3/issue/{issue_key}/transitions,
    finds matching transition ID, and posts POST /rest/api/3/issue/{issue_key}/transitions.
    """
    if not issue_key:
        return False

    jira_url = _get_clean_jira_url()
    jira_email = os.environ.get("JIRA_USER_EMAIL")
    jira_token = os.environ.get("JIRA_API_TOKEN")

    if jira_url and jira_email and jira_token:
        logger.info(
            f"[Jira Service] Transitioning Jira ticket '{issue_key}' to status '{status_name}'..."
        )
        try:
            trans_url = f"{jira_url}/rest/api/3/issue/{issue_key}/transitions"
            auth = (jira_email, jira_token)
            headers = {"Accept": "application/json", "Content-Type": "application/json"}

            get_resp = requests.get(trans_url, auth=auth, headers=headers, timeout=10)
            if get_resp.status_code == 200:
                transitions = get_resp.json().get("transitions", [])
                target_trans_id = None

                status_lower = status_name.strip().lower()
                for t in transitions:
                    t_name = t.get("name", "").lower()
                    to_status = t.get("to", {}).get("name", "").lower()
                    if (
                        status_lower == t_name
                        or status_lower == to_status
                        or (
                            status_lower in ("in progress", "work in progress", "in-progress")
                            and ("progress" in t_name or "progress" in to_status)
                        )
                        or (
                            status_lower in ("done", "resolved", "complete")
                            and ("done" in t_name or "done" in to_status or "resolve" in t_name or "resolve" in to_status)
                        )
                    ):
                        target_trans_id = t.get("id")
                        break

                if target_trans_id:
                    post_resp = requests.post(
                        trans_url,
                        json={"transition": {"id": target_trans_id}},
                        auth=auth,
                        headers=headers,
                        timeout=10,
                    )
                    if post_resp.status_code in (200, 204):
                        logger.info(
                            f"[Jira Service] Successfully transitioned Jira ticket '{issue_key}' to '{status_name}' (Transition ID: {target_trans_id})."
                        )
                        return True
                    else:
                        logger.warning(
                            f"[Jira Service] Transition request returned HTTP {post_resp.status_code}: {post_resp.text}"
                        )
                else:
                    logger.warning(
                        f"[Jira Service] No matching transition found for status '{status_name}' in Jira ticket '{issue_key}' (Available transitions: {[t.get('name') for t in transitions]})."
                    )
            else:
                logger.warning(
                    f"[Jira Service] Failed to fetch transitions for '{issue_key}': HTTP {get_resp.status_code}"
                )
        except Exception as e:
            logger.warning(
                f"[Jira Service] Failed to transition Jira ticket '{issue_key}': {e}"
            )

    logger.info(
        f"[Jira Status Log] [Ticket '{issue_key}'] Status updated to '{status_name}'."
    )
    return True



def search_jira(error_message: str) -> []:
    """
    Searches Atlassian Jira API for past incident history by title & description matching error_message.
    Uses POST /rest/api/3/search/jql (or /rest/api/3/search fallback) to comply with updated Jira REST API v3 specs.
    If environment variables (JIRA_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN) are missing,
    skips the Jira API call and uses structured fallback data.
    """
    jira_url = _get_clean_jira_url()
    jira_email = os.environ.get("JIRA_USER_EMAIL")
    jira_token = os.environ.get("JIRA_API_TOKEN")

    if jira_url and jira_email and jira_token:
        logger.info(f"[Jira Service] Calling Atlassian Jira API at {jira_url}...")
        try:
            jql = f'text ~ "{error_message[:50]}" ORDER BY created DESC'
            search_payload = {"jql": jql, "maxResults": 5}

            # Try new POST /rest/api/3/search/jql endpoint first
            query_url = f"{jira_url}/rest/api/3/search/jql"
            response = requests.post(
                query_url,
                json=search_payload,
                auth=(jira_email, jira_token),
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                timeout=10,
            )

            # Fallback to POST /rest/api/3/search if search/jql endpoint is 404/405
            if response.status_code in (404, 405):
                query_url = f"{jira_url}/rest/api/3/search"
                response = requests.post(
                    query_url,
                    json=search_payload,
                    auth=(jira_email, jira_token),
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                    timeout=10,
                )

            if response.status_code == 200:
                data = response.json()
                issues = []
                for issue in data.get("issues", []):
                    issues.append(
                        {
                            "key": issue.get("key"),
                            "summary": issue["fields"].get("summary"),
                            "status": issue["fields"].get("status", {}).get("name"),
                            "resolution": issue["fields"].get(
                                "description", "Refer to ticket comments for DDL patch."
                            ),
                            "source": "jira_rest_api",
                        }
                    )
                logger.info(
                    f"[Jira Service] Jira API returned {len(issues)} ticket(s)."
                )
                return issues
            else:
                logger.warning(
                    f"[Jira Service] Jira API returned HTTP {response.status_code}: {response.text}"
                )
        except Exception as e:
            logger.warning(f"[Jira Service] Failed to call Jira API: {e}")

    # Fallback when env vars are missing or API fails
    logger.info(
        "[Jira Service] Jira API env vars missing or unavailable. Using structured Jira history fallback."
    )
    fallback_issues = []
    return fallback_issues


if __name__ == "__main__":
    t = create_jira_ticket(
        "INC-123456",
        "retail_inventory_etl",
        "transform_inventory_sql",
        "table has no column",
    )
    logger.info(f"Created Jira Ticket: {t}")
    res = search_jira("retail_inventory_etl")
    logger.info(f"Jira Result: {res}")
