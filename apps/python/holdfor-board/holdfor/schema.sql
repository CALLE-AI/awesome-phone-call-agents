CREATE TABLE IF NOT EXISTS patient (
    id              INTEGER PRIMARY KEY,
    first_name      TEXT    NOT NULL,
    surname         TEXT    NOT NULL,
    dob             TEXT    NOT NULL,
    phone_e164      TEXT    NOT NULL,
    consent_to_call INTEGER NOT NULL,
    created_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS appointment (
    id                 INTEGER PRIMARY KEY,
    patient_id         INTEGER NOT NULL REFERENCES patient(id),
    seen_on            TEXT    NOT NULL,
    appointment_type   TEXT    NOT NULL,
    medication_changed INTEGER NOT NULL,
    followup_booked    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS call_attempt (
    id              INTEGER PRIMARY KEY,
    appointment_id  INTEGER NOT NULL REFERENCES appointment(id),
    kind            TEXT    NOT NULL,
    idempotency_key TEXT    NOT NULL UNIQUE,
    provider_run_id TEXT,
    state           TEXT    NOT NULL,
    transcript_path TEXT,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS review_item (
    id                 INTEGER PRIMARY KEY,
    call_attempt_id    INTEGER NOT NULL REFERENCES call_attempt(id),
    feeling            TEXT,
    medication_ok      TEXT,
    wants_seen         TEXT,
    carried_words_text TEXT,
    carried_words_turn INTEGER,
    stop_condition     INTEGER NOT NULL,
    stop_reason        TEXT,
    status             TEXT    NOT NULL,
    created_at         TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS release (
    id             INTEGER PRIMARY KEY,
    review_item_id INTEGER NOT NULL REFERENCES review_item(id),
    reviewer_name  TEXT    NOT NULL,
    released_at    TEXT    NOT NULL,
    earliest_date  TEXT    NOT NULL,
    latest_date    TEXT    NOT NULL,
    time_of_day    TEXT    NOT NULL,
    mode           TEXT    NOT NULL,
    clinician      TEXT,
    approved_words TEXT    NOT NULL
);

-- One row per live placement. A table rather than a column on call_attempt so
-- that `db.init` adds it to a database that already exists: CREATE TABLE IF NOT
-- EXISTS creates a missing table, but never a missing column.
CREATE TABLE IF NOT EXISTS live_call (
    id              INTEGER PRIMARY KEY,
    call_attempt_id INTEGER NOT NULL REFERENCES call_attempt(id),
    placed_at       TEXT    NOT NULL
);
