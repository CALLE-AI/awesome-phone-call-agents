import os
import json

PLAYBOOK_FILE = os.path.join(os.path.dirname(__file__), '..', 'playbook', 'playbook.json')

def search_playbook(error_message: str):
    """Searches the playbook for matching error patterns."""
    if not os.path.exists(PLAYBOOK_FILE):
        return None
        
    try:
        with open(PLAYBOOK_FILE, 'r') as f:
            entries = json.load(f)
            
        for entry in entries:
            if entry.get("pattern", "").lower() in error_message.lower():
                print(f"[Playbook Service] Matched Runbook '{entry['id']}': {entry['title']}")
                return entry
    except Exception as e:
        print(f"[Playbook Service] Error reading playbook: {e}")
        
    print("[Playbook Service] No direct playbook match found.")
    return None

if __name__ == "__main__":
    res = search_playbook("table daily_store_inventory_agg has no column named inventory_status")
    print("Search Result:", res)
