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

-- `answers_from` is 'agent' when the call itself returned the answers, 'transcript'
-- when this app read them back out of the recording afterwards, and NULL when nobody
-- has any. A Reviewer looking at "worse" is entitled to know which, because the two
-- are not equally close to the person who said it.
--
-- It arrived after this table did, so `db.init` also adds it by name to a ledger that
-- already exists: see ADDED_COLUMNS in db.py. Comments stay outside the table body,
-- because SQLite re-parses the stored CREATE TABLE text to run ALTER TABLE DROP
-- COLUMN and a comment left dangling beside a removed column fails that parse.
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
    created_at         TEXT    NOT NULL,
    answers_from       TEXT
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

-- One Review Item holds one Release. An index rather than a UNIQUE column so that
-- `db.init` applies it to a database that already exists, and because it also closes
-- a race: review.release checked for an existing row with a SELECT before its INSERT,
-- which two concurrent posts could both pass. See docs/adr/0006, amendment.
CREATE UNIQUE INDEX IF NOT EXISTS release_one_per_review_item
    ON release(review_item_id);

-- One Review Item per attempt. Added when the board stopped waiting for the poll:
-- the write can now arrive from a background worker, from a second press, or from a
-- process that restarted mid-call, and the LEFT JOIN that looks for an existing item
-- is a read two of those could both pass. Same shape and same reason as the index
-- above.
CREATE UNIQUE INDEX IF NOT EXISTS review_item_one_per_attempt
    ON review_item(call_attempt_id);

-- Every offer reception made, in the order she made them. Reception revises, so
-- acceptance is plural: the Binding Acceptance is the last row with accepted = 1, and
-- the earlier rows are kept as evidence rather than overwritten. A withdrawn 09:10 is
-- the reason a booking reads 08:50. See docs/adr/0012.
--
-- verdict is what the Envelope Match made of the offer, never what the agent thought:
--   inside      the offer names a day and time the Booking Envelope allows
--   outside     it names a day or time the envelope does not allow
--   unreadable  the turn names no day we can read, so nothing is claimed about it
CREATE TABLE IF NOT EXISTS rebooking_offer (
    id              INTEGER PRIMARY KEY,
    call_attempt_id INTEGER NOT NULL REFERENCES call_attempt(id),
    turn_index      INTEGER NOT NULL,
    spoken_text     TEXT    NOT NULL,
    accepted        INTEGER NOT NULL,
    matched_date    TEXT,
    matched_time    TEXT,
    verdict         TEXT    NOT NULL,
    created_at      TEXT    NOT NULL
);
