"""Runtime settings. Every default fails closed: mock provider, empty allowlist, tiny budget.

Ported from ShiftFill with the CALL-E, budget and TokenRouter blocks intact — they are the part that
has been live-tested — and the shift domain replaced by the block captain's.

Two settings look like dead weight and are not. `ENABLE_SPLIT_COVERAGE` and
`REQUIRE_MANAGER_APPROVAL` mean nothing in BuddyE, but `app/calls/preflight.py` reads both when it
builds the `/api/calle/status` snapshot, and `refresh_loop` swallows exceptions — so deleting them
would not raise anywhere visible, it would just leave the status panel permanently empty. They stay,
inert and documented, until preflight is ported.
"""
from __future__ import annotations

import secrets
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BANDS = frozenset({"routine", "elevated", "high", "critical"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- app ---
    DATABASE_URL: str = "sqlite:///./buddye.db"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
    STEP_DELAY_S: float = 0.6  # pacing between orchestrator steps so the UI can breathe

    # --- the block ---
    # The captain is named out loud on every call ("Alma Reyes asked us to ring round"), so this is
    # not decoration: a check-in call from nobody in particular is a call people hang up on.
    BLOCK_CAPTAIN_NAME: str = "Alma Reyes"
    BLOCK_CAPTAIN_PHONE: str = ""  # notification target only; BuddyE never dials this number
    AREA_NAME: str = "Maryvale, Phoenix"

    # --- the escalation ladder ---
    # BuddyE may ring the person a neighbour nominated. It may never ring an agency: that rung is a
    # HandoffPacket a named human releases, and there is no setting here that can change it.
    CALL_EMERGENCY_CONTACTS: bool = True
    # Below this triage band an unanswered or urgent call stops at the block captain instead of
    # having a responder packet prepared. A packet is a page about a frail person's home, and
    # cutting one for every routine no-answer would train the captain to ignore them.
    HANDOFF_MIN_BAND: str = "high"

    # --- call provider ---
    CALL_PROVIDER: str = "mock"  # mock | calle_sdk | calle_mcp
    MOCK_DELAY_S: float = 1.2  # simulated dial/talk time per mock event
    CALL_BUDGET_MAX: int = 4  # hard cap on real calls per database
    CALL_BUDGET_ENFORCE: bool = True
    DIALABLE_NUMBERS: str = ""  # comma-separated E.164 allowlist for real providers
    # Injected into the seeded roster by app.seed (see its DEMO_NAMES map, which looks these up by
    # name via getattr — rename one of these and real numbers silently stop reaching the roster).
    DEMO_PHONE_A: str = ""  # Rosa Delgado
    DEMO_PHONE_B: str = ""  # Walter Brzezinski
    DEMO_PHONE_C: str = ""  # Ernesto Salgado

    # --- CALL-E developer API (SDK provider) ---
    CALLE_API_KEY: str = ""
    CALLE_BASE_URL: str = "https://api.heycall-e.com"
    CALLE_WEBHOOK_SECRET: str = Field(default_factory=lambda: secrets.token_urlsafe(24))
    PUBLIC_BASE_URL: str = ""  # e.g. https://buddye.example.com ; webhook_url only sent when set
    CALLE_POLL_INTERVAL_S: float = 3.0
    CALLE_CALL_TIMEOUT_S: float = 600.0

    # --- CALL-E CLI / MCP provider ---
    CALLE_CLI_BIN: str = "calle"

    # --- optional LLM reconcile step ---
    # auto = pick from whichever key is present (TokenRouter first); none = never call a model.
    RECONCILER: str = "auto"  # auto | none | glm | anthropic
    TOKENROUTER_API_KEY: str = ""
    TOKENROUTER_BASE_URL: str = "https://api.tokenrouter.com/v1"
    # glm-5.3-flash over glm-5.3-free: measured 2.7 s against 22 s on the same prompt, and
    # the free variant returned empty content and timed out repeatedly under load. The flash
    # tier is the cheap one and the quality is not worse — it is better on these prompts.
    RECONCILE_MODEL: str = "z-ai/glm-5.3-flash"
    RECONCILE_TIMEOUT_S: float = 90.0  # free tier measured ~50 s; a retry would only double the wait
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_RECONCILE_MODEL: str = "claude-opus-5"

    # --- the operator layer ---
    # The person whose name goes on generated paperwork as "prepared by". It is NEVER used to
    # authorise anything: an agency dispatch and a handoff packet both require a name supplied in
    # the request, by the human making the decision, at the moment they make it. A settings value
    # that could approve an ambulance would mean the ambulance was approved by a config file.
    OVERSEER_NAME: str = ""
    #: Community resources are committed and started as soon as an incident opens. Agency units are
    #: never affected by this — they stay PROPOSED whatever it is set to. Off means every dispatch,
    #: including a case of water, waits for a coordinator to press send.
    AUTO_DISPATCH: bool = True
    #: How often the background loop reconciles escalations into incidents, in seconds. The incident
    #: table is derived state, so a missed pass costs a couple of seconds and nothing else.
    INCIDENT_SYNC_S: float = 2.0
    #: How often the movement simulator advances assets. Purely a smoothness knob: arrival times
    #: come from elapsed wall-clock time, so a longer tick means chunkier movement, never a later
    #: arrival.
    MOVEMENT_TICK_S: float = 2.0

    # --- inert, read by app/calls/preflight.py; see the module docstring ---
    ENABLE_SPLIT_COVERAGE: bool = False
    REQUIRE_MANAGER_APPROVAL: bool = False

    @field_validator("RECONCILER")
    @classmethod
    def _reconciler_known(cls, v: str) -> str:
        if v not in {"auto", "none", "glm", "anthropic"}:
            raise ValueError(f"unknown RECONCILER {v!r}")
        return v

    @field_validator("CALL_PROVIDER")
    @classmethod
    def _provider_known(cls, v: str) -> str:
        if v not in {"mock", "calle_sdk", "calle_mcp"}:
            raise ValueError(f"unknown CALL_PROVIDER {v!r}")
        return v

    @field_validator("HANDOFF_MIN_BAND")
    @classmethod
    def _band_known(cls, v: str) -> str:
        band = str(v).strip().lower()
        if band not in BANDS:
            raise ValueError(f"HANDOFF_MIN_BAND must be one of {sorted(BANDS)}, not {v!r}")
        return band

    @field_validator("CALLE_WEBHOOK_SECRET", mode="before")
    @classmethod
    def _token_not_empty(cls, v: str | None) -> str:
        # An empty value in .env must not disable the webhook path token.
        return v if isinstance(v, str) and v.strip() else secrets.token_urlsafe(24)

    @property
    def dialable_numbers(self) -> set[str]:
        return {n.strip() for n in self.DIALABLE_NUMBERS.split(",") if n.strip()}

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_real_provider(self) -> bool:
        return self.CALL_PROVIDER != "mock"


@lru_cache
def get_settings() -> Settings:
    return Settings()
