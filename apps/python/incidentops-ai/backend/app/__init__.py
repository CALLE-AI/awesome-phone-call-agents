import json
import os

DB_FILE = "incident_history.json"


def load_history():

    if not os.path.exists(DB_FILE):
        return []

    with open(DB_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_incident(data):

    history = load_history()

    history.append(data)

    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(
            history,
            f,
            indent=4,
            ensure_ascii=False
        )


def get_history():

    return load_history()
