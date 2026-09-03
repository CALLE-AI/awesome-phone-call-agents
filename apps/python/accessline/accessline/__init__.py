"""AccessLine — a narrow venue-accessibility verification caller for the CALL-E concept."""

from accessline.adapter import (
    CallEAdapter,
    CallERestProvider,
    MockCallEProvider,
)
from accessline.exceptions import CallEUnavailable
from accessline.calle_contract import (
    AUTH_ENV_VAR,
    BASE_URL_ENV_VAR,
    IMPLEMENTATION_STATE_READY,
)
from accessline.calle_rest import CallERestClient, CallERestRequestSpec
from accessline.ledger import CallLedger, CallLedgerError
from accessline.schema import (
    AccessLineInput,
    AccessLineResult,
    AccessibilityAnswer,
    CompletionStatus,
    validate_result,
)
from accessline.live_auth import LiveAuthorizationError, LiveCallIntent, assert_strict_e164
from accessline.origin import APPROVED_CALL_E_ORIGINS, assert_approved_call_e_origin
from accessline.privacy import mask_phone
from accessline.workflow import AccessLineWorkflow, ConsentRequired, WorkflowError

__all__ = [
    "AccessLineInput",
    "AccessLineResult",
    "AccessLineWorkflow",
    "AccessibilityAnswer",
    "APPROVED_CALL_E_ORIGINS",
    "AUTH_ENV_VAR",
    "BASE_URL_ENV_VAR",
    "CallEAdapter",
    "CallERestClient",
    "CallERestProvider",
    "CallERestRequestSpec",
    "CallEUnavailable",
    "CallLedger",
    "CallLedgerError",
    "CompletionStatus",
    "ConsentRequired",
    "IMPLEMENTATION_STATE_READY",
    "LiveAuthorizationError",
    "LiveCallIntent",
    "MockCallEProvider",
    "WorkflowError",
    "assert_approved_call_e_origin",
    "assert_strict_e164",
    "mask_phone",
    "validate_result",
]
