from fastapi import APIRouter, HTTPException

from app.database.database import get_connection


router = APIRouter()


@router.get("/{incident_id}")
def get_incident(incident_id: int):

    connection = get_connection()

    row = connection.execute(
        """
        SELECT *
        FROM incidents
        WHERE id = ?
        """,
        (incident_id,),
    ).fetchone()

    connection.close()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    return dict(row)