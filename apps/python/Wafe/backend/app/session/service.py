from app.database.database import get_connection


def create_session(
    session_id: str,
    call_id: str,
    phone_number: str,
):
    connection = get_connection()

    connection.execute(
        """
        INSERT INTO sessions (
            id,
            call_id,
            phone_number,
            status
        )
        VALUES (?, ?, ?, ?)
        """,
        (
            session_id,
            call_id,
            phone_number,
            "starting",
        ),
    )

    connection.commit()
    connection.close()


def get_session(session_id: str):
    connection = get_connection()

    row = connection.execute(
        """
        SELECT *
        FROM sessions
        WHERE id = ?
        """,
        (session_id,),
    ).fetchone()

    connection.close()

    if row is None:
        return None

    return dict(row)


def update_session_status(
    session_id: str,
    status: str,
):
    connection = get_connection()

    connection.execute(
        """
        UPDATE sessions
        SET status = ?
        WHERE id = ?
        """,
        (
            status,
            session_id,
        ),
    )

    connection.commit()
    connection.close()