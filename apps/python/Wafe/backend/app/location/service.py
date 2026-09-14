from app.database.database import get_connection


def save_location(
    session_id: str,
    latitude: float,
    longitude: float,
    accuracy: float | None = None,
):
    connection = get_connection()

    connection.execute(
        """
        INSERT INTO locations (
            session_id,
            latitude,
            longitude,
            accuracy,
            updated_at
        )
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(session_id)
        DO UPDATE SET
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            accuracy = excluded.accuracy,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            session_id,
            latitude,
            longitude,
            accuracy,
        ),
    )

    connection.commit()
    connection.close()


def get_location(session_id: str):
    connection = get_connection()

    row = connection.execute(
        """
        SELECT *
        FROM locations
        WHERE session_id = ?
        """,
        (session_id,),
    ).fetchone()

    connection.close()

    if row is None:
        return None

    return dict(row)