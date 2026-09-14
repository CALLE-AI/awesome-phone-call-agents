from fastapi import APIRouter
from pydantic import BaseModel

from app.location.service import save_location, get_location


router = APIRouter()


class LocationUpdate(BaseModel):
    session_id: str
    latitude: float
    longitude: float
    accuracy: float | None = None


@router.post("")
def update_location(location: LocationUpdate):

    save_location(
        session_id=location.session_id,
        latitude=location.latitude,
        longitude=location.longitude,
        accuracy=location.accuracy,
    )

    return {
        "success": True,
        "session_id": location.session_id,
    }


@router.get("/{session_id}")
def current_location(session_id: str):

    location = get_location(session_id)

    if location is None:
        return {
            "success": False,
            "location": None,
        }

    return {
        "success": True,
        "location": location,
    }