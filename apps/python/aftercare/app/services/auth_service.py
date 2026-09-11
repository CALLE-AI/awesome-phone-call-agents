from datetime import datetime, timezone

from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    refresh_token_expiry,
    verify_password,
)
from app.models.orm import RefreshToken, User
from app.models.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    TokenPair,
    UserCreate,
    UserRead,
)
from app.repositories.user_repository import UserRepository


def _utc_now_naive() -> datetime:
    """UTC timestamp without tzinfo for naive DateTime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AuthServiceError(Exception):
    """Domain/service error for auth operations."""

    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


class AuthService:
    def __init__(self, users: UserRepository):
        self.users = users

    def register(self, payload: UserCreate) -> tuple[User, TokenPair]:
        email = payload.email.lower()
        if self.users.get_by_email(email):
            raise AuthServiceError("Email already registered", status_code=409)

        user = User(
            email=email,
            full_name=payload.full_name.strip(),
            password_hash=hash_password(payload.password),
            is_active=True,
            created_at=_utc_now_naive(),
        )
        user = self.users.create(user)
        tokens = self._issue_token_pair(user)
        return user, tokens

    def login(self, payload: LoginRequest) -> TokenPair:
        user = self.users.get_by_email(payload.email.lower())
        if (
            user is None
            or not user.is_active
            or not verify_password(payload.password, user.password_hash)
        ):
            raise AuthServiceError("Invalid email or password", status_code=401)
        return self._issue_token_pair(user)

    def refresh(self, refresh_token: str) -> TokenPair:
        stored = self._get_valid_refresh(refresh_token)
        user = self.users.get_by_id(stored.user_id)
        if user is None or not user.is_active:
            raise AuthServiceError("Invalid refresh token", status_code=401)

        self.users.revoke_refresh_token(stored)
        return self._issue_token_pair(user)

    def logout(self, refresh_token: str) -> None:
        token_hash = hash_refresh_token(refresh_token)
        stored = self.users.get_refresh_by_hash(token_hash)
        if stored is None or stored.revoked_at is not None:
            return
        self.users.revoke_refresh_token(stored)

    def change_password(self, user: User, payload: ChangePasswordRequest) -> None:
        if not verify_password(payload.current_password, user.password_hash):
            raise AuthServiceError("Current password is incorrect", status_code=401)
        user.password_hash = hash_password(payload.new_password)
        self.users.save(user)
        self.users.revoke_all_refresh_tokens(user.id)

    def get_active_user(self, user_id: int) -> User:
        user = self.users.get_by_id(user_id)
        if user is None or not user.is_active:
            raise AuthServiceError("Not authenticated", status_code=401)
        return user

    def to_user_read(self, user: User) -> UserRead:
        return UserRead.model_validate(user)

    def _issue_token_pair(self, user: User) -> TokenPair:
        raw_refresh = generate_refresh_token()
        self.users.create_refresh_token(
            RefreshToken(
                user_id=user.id,
                token_hash=hash_refresh_token(raw_refresh),
                expires_at=refresh_token_expiry().replace(tzinfo=None),
                created_at=_utc_now_naive(),
            )
        )
        return TokenPair(
            access_token=create_access_token(user_id=user.id),
            refresh_token=raw_refresh,
        )

    def _get_valid_refresh(self, refresh_token: str) -> RefreshToken:
        token_hash = hash_refresh_token(refresh_token)
        stored = self.users.get_refresh_by_hash(token_hash)
        if stored is None or stored.revoked_at is not None:
            raise AuthServiceError("Invalid refresh token", status_code=401)

        expires_at = stored.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            raise AuthServiceError("Invalid refresh token", status_code=401)
        return stored
