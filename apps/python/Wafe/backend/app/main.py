from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.api.sessions import router as sessions_router
from app.api.webhooks import router as webhooks_router
from app.database.database import initialize_database
from app.api.incidents import router as incidents_router
from app.api.location import router as location_router
from fastapi.responses import FileResponse
from pathlib import Path
from app.api.alerts import router as alerts_router
from app.api.session_end import router as session_end_router

from app.api.session_status import (
    router as session_status_router
)


initialize_database()


app = FastAPI(
    title="CALL-E Walk Me Home",
    version="0.1.0",
)

STATIC_DIR = Path(__file__).parent / "static"

app.mount(
    "/static",
    StaticFiles(directory=STATIC_DIR),
    name="static",
)

app.include_router(
    sessions_router,
    prefix="/api/session",
)

app.include_router(
    webhooks_router,
    prefix="/api/webhook",
)

app.include_router(
    incidents_router,
    prefix="/api/incidents",
)

app.include_router(
    location_router,
    prefix="/api/location",
)

app.include_router(
    alerts_router,
    prefix="/api/alerts",
)

app.include_router(
    session_status_router,
    prefix="/api/session/status",
)

app.include_router(
    session_end_router,
    prefix="/api/session/end",
)


@app.get("/")
def root():
    return {
        "name": "CALL-E Walk Me Home",
        "status": "running",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
    }

@app.get("/location-test")
def location_test():
    return FileResponse(
        Path(__file__).parent / "static" / "location_test.html"
    )

@app.get("/trusted-contact")
def trusted_contact():
    return FileResponse(
        Path(__file__).parent
        / "static"
        / "trusted_contact.html"
    )

@app.get("/walk")
def walk_home():
    return FileResponse(
        Path(__file__).parent
        / "static"
        / "user.html"
    )
