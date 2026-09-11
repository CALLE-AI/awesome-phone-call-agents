import os
import firebase_admin
from firebase_admin import auth, credentials
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

# Initialize Firebase Admin SDK
# In production, this uses GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_CONFIG env vars.
# If those aren't present and we're not in test mode, it might fail. We'll catch and log.
try:
    if not firebase_admin._apps:
        # If FIREBASE_SERVICE_ACCOUNT_JSON is provided, use it. Otherwise, default credentials.
        cert_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if cert_path and os.path.exists(cert_path):
            cred = credentials.Certificate(cert_path)
            firebase_admin.initialize_app(cred)
        else:
            # For token verification only, we just need the project ID
            firebase_admin.initialize_app(options={'projectId': 'gen-lang-client-0574518291'})
except Exception as e:
    print(f"Warning: Firebase Admin SDK initialization failed: {e}")

EXPECTED_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "gen-lang-client-0574518291")
ALLOWED_CLINICAL_ROLES = {"admin", "super_admin", "clinician"}

def verify_jwt_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Verifies a Firebase ID token and validates origin audience/issuer.
    Bypasses verification if MEDOPS_TEST_MODE or MEDOPS_BYPASS_AUTH is active for dev/test.
    """
    bypass_auth = os.environ.get("MEDOPS_BYPASS_AUTH", "").lower() in ("1", "true", "yes", "on")
    test_mode = os.environ.get("MEDOPS_TEST_MODE", "").lower() in ("1", "true", "yes", "on")
    if bypass_auth or test_mode:
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
    """
    role = payload.get("role") or payload.get("custom_claims", {}).get("role", "clinician")
    if role not in ALLOWED_CLINICAL_ROLES:
        raise HTTPException(
            status_code=403,
            detail=f"Role '{role}' is not authorized for sensitive clinical actions"
        )
    return payload

