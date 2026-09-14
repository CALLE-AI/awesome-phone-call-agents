from fastapi import APIRouter, HTTPException

from app.database.database import get_connection


router = APIRouter()


@router.get("")
def get_alerts():
    connection = get_connection()

    rows = connection.execute(
        """
        SELECT *
        FROM alerts
        ORDER BY created_at DESC
        """
    ).fetchall()

    connection.close()

    return {
        "alerts": [dict(row) for row in rows]
    }


@router.get("/{alert_id}")
def get_alert(alert_id: int):
    connection = get_connection()

    row = connection.execute(
        """
        SELECT *
        FROM alerts
        WHERE id = ?
        """,
        (alert_id,),
    ).fetchone()

    connection.close()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Alert not found",
        )

    return dict(row)


@router.post("/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int):
    connection = get_connection()

    cursor = connection.execute(
        """
        UPDATE alerts
        SET status = ?
        WHERE id = ?
        """,
        ("acknowledged", alert_id),
    )

    connection.commit()

    updated = cursor.rowcount

    connection.close()

    if updated == 0:
        raise HTTPException(
            status_code=404,
            detail="Alert not found",
        )

    return {
        "success": True,
        "alert_id": alert_id,
        "status": "acknowledged",
    }