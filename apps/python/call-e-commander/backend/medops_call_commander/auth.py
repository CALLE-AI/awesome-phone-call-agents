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
            firebase_admin.initialize_app()
except Exception as e:
    print(f"Warning: Firebase Admin SDK initialization failed: {e}")

def verify_jwt_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Verifies a Firebase ID token.
    Bypasses verification if MEDOPS_TEST_MODE is active to allow tests to run.
    """
    if os.environ.get("MEDOPS_TEST_MODE") == "1":
        # In test mode, allow tests to pass by simulating a valid token payload.
        # Tests can pass a mock token to specify roles, e.g., "admin_test_token"
        token = credentials.credentials
        role = "super_admin" if "admin" in token else "clinician"
        return {"uid": "test_user_id", "email": "test@medops.local", "role": role}

    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        # We can enforce custom claims for roles if they are set in Firebase
        # role = decoded_token.get("role", "clinician")
        return decoded_token
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {str(e)}")
