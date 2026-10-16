from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    # -------- Gemini --------
    gemini_api_key: str = ""

    gemini_model: str = "gemini-3.5-flash"

    # -------- Backward compatibility --------
    openai_api_key: str = "NOT_USED"

    llm_model: str = Field(
        default="gemini-3.5-flash",
        validation_alias="GEMINI_MODEL",
    )

    # -------- CALL-E --------
    oncall_phone: str = ""

    calle_api_key: str = ""
    calle_language: str = "English"

    safe_demo_mode: bool = True

    # Required only for remote live escalation.
    # Empty means the live escalation API is disabled.
    incidentops_api_token: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )


settings = Settings()
