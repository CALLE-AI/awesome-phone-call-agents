import os
import firebase_admin
from firebase_admin import auth, credentials
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

try:
    if not firebase_admin._apps:
        cert_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if cert_path and os.path.exists(cert_path):
            cred = credentials.Certificate(cert_path)
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app(options={'projectId': 'gen-lang-client-0574518291'})
except Exception as e:
    print(f"Warning: Firebase Admin SDK initialization failed: {e}")

EXPECTED_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "gen-lang-client-0574518291")
ALLOWED_CLINICAL_ROLES = {"admin", "super_admin", "clinician"}


def _bypass_active() -> bool:
    return os.environ.get("MEDOPS_BYPASS_AUTH", "").lower() in ("1", "true", "yes", "on") or \
        os.environ.get("MEDOPS_TEST_MODE", "").lower() in ("1", "true", "yes", "on")


def _require_mock_mode_for_bypass() -> None:
    """
    Auth-bypass/test mode must never be able to place a real call or reach a
    real private record. If someone enables MEDOPS_BYPASS_AUTH /
    MEDOPS_TEST_MODE without also forcing CALLE_MOCK_MODE, we force it here
    rather than silently allowing live calls under a fake identity.
    """
    if os.environ.get("CALLE_MOCK_MODE", "").lower() not in ("1", "true", "yes", "on"):
        os.environ["CALLE_MOCK_MODE"] = "1"


def verify_jwt_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Verifies a Firebase ID token and validates origin audience/issuer.
    In bypass/test mode, CALLE_MOCK_MODE is force-enabled so bypassed
    requests can never dispatch a live call or touch real patient records.
    """
    if _bypass_active():
        _require_mock_mode_for_bypass()
        token = credentials.credentials
        if "unauthorized" in token or "forbidden" in token:
            role = "unauthorized_guest"
        elif "admin" in token:
            role = "admin"
        else:
            role = "clinician"
        return {"uid": "test_user_id", "email": "test@medops.local", "role": role}

    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        aud = decoded_token.get("aud")
        iss = decoded_token.get("iss")
        expected_iss = f"https://securetoken.google.com/{EXPECTED_PROJECT_ID}"
        if aud != EXPECTED_PROJECT_ID or iss != expected_iss:
            raise HTTPException(
                status_code=401,
                detail=f"Arbitrary credential origin rejected: expected project {EXPECTED_PROJECT_ID}"
            )
        return decoded_token
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {str(e)}")


def verify_clinical_admin_role(payload: dict = Security(verify_jwt_token)) -> dict:
    """
    Enforces bounded role authorization for sensitive clinical actions.
    A missing/unrecognized role is rejected outright — it is never treated
    as an implicit "clinician" grant.
    """
    role = payload.get("role") or payload.get("custom_claims", {}).get("role")
    if not role or role not in ALLOWED_CLINICAL_ROLES:
        raise HTTPException(
            status_code=403,
            detail=f"Role '{role or 'missing'}' is not authorized for sensitive clinical actions"
        )
    return payload
