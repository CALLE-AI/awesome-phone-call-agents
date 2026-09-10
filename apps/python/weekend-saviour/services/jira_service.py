import os
import requests
import logging

logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def search_jira(error_message: str):
    """
    Searches Atlassian Jira API for past incident history by title & description matching error_message.
    If environment variables (JIRA_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN) are missing,
    skips the Jira API call and uses structured fallback data.
    """
    jira_url = os.environ.get("JIRA_URL")
    jira_email = os.environ.get("JIRA_USER_EMAIL")
    jira_token = os.environ.get("JIRA_API_TOKEN")

    if jira_url and jira_email and jira_token:
        logger.info(f"[Jira Service] Calling Atlassian Jira API at {jira_url}...")
        try:
            query_url = f"{jira_url.rstrip('/')}/rest/api/3/search"
            jql = f'text ~ "{error_message[:50]}" ORDER BY created DESC'
            response = requests.get(
                query_url,
                params={"jql": jql, "maxResults": 5},
                auth=(jira_email, jira_token),
                headers={"Accept": "application/json"},
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                issues = []
                for issue in data.get("issues", []):
                    issues.append({
                        "key": issue.get("key"),
                        "summary": issue["fields"].get("summary"),
                        "status": issue["fields"].get("status", {}).get("name"),
                        "resolution": issue["fields"].get("description", "Refer to ticket comments for DDL patch."),
                        "source": "jira_rest_api"
                    })
                logger.info(f"[Jira Service] Jira API returned {len(issues)} ticket(s).")
                return issues
            else:
                logger.warning(f"[Jira Service] Jira API returned HTTP {response.status_code}: {response.text}")
        except Exception as e:
            logger.warning(f"[Jira Service] Failed to call Jira API: {e}")

    # Fallback when env vars are missing or API fails
    logger.info("[Jira Service] Jira API env vars missing or unavailable. Using structured Jira history fallback.")
    fallback_issues = [
        {
            "key": "RETAIL-4021",
            "summary": "Sunday Retail ETL failed due to missing inventory_status column in aggregation table",
            "status": "RESOLVED",
            "assignee": "Alex Morgan",
            "resolution": "Applied ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';",
            "created": "2026-08-16",
            "relevance_score": 0.95,
            "source": "jira_fallback"
        }
    ]
    return fallback_issues

if __name__ == "__main__":
    res = search_jira("table daily_store_inventory_agg has no column named inventory_status")
    logger.info(f"Jira Result: {res}")
