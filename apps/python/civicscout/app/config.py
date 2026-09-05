import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App Settings
    APP_NAME: str = "CivicScout"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    PORT: int = 8080
    HOST: str = "0.0.0.0"

    # Google Cloud & Firestore Settings
    GCP_PROJECT_ID: str = "civicscout-hackathon"
    FIRESTORE_DATABASE: str = "(default)"
    FIRESTORE_COLLECTION_TICKETS: str = "civic_tickets"
    FIRESTORE_COLLECTION_CALLS: str = "call_audit_logs"
    FIRESTORE_COLLECTION_AUTH_CODES: str = "municipal_auth_codes"
    FIRESTORE_USE_MOCK: bool = True  # Defaults to True for zero-friction local/offline testing

    # CALL-E API & SDK Settings
    CALLE_API_KEY: str = "demo-calle-key-hackathon"
    CALLE_API_BASE_URL: str = "https://api.heycall-e.com/v1"
    WEBHOOK_BASE_URL: str = "https://civicscout-service-xyz.a.run.app"
    DEFAULT_CALLER_ID: str = "+18005553110"  # Civic 311 Outbound Line

    # FastMCP Settings
    MCP_SERVER_NAME: str = "CivicScout-Municipal-Tools"
    MCP_SERVER_VERSION: str = "1.0.0"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
