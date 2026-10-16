from fastapi import FastAPI

from app.routes.incident import router as incident_router

from app.database.db import Base, engine

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="CALL-E IncidentOps AI",
    version="0.1.0"
)


@app.get("/")
def root():
    return {
        "message": "CALL-E IncidentOps AI Backend",
        "status": "running"
    }


app.include_router(incident_router)
