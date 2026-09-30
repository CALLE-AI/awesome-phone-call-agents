from app.api.dependencies import (
    get_auth_service,
    get_current_user,
    require_register_secret,
)
from app.api.exceptions import raise_http_from_auth_error
from app.models.orm import User
from app.models.schemas import (
    AuthRegisterResponse,
    ChangePasswordRequest,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    TokenPair,
    UserCreate,
    UserRead,
)
from app.services.auth_service import AuthService, AuthServiceError
from fastapi import APIRouter, Depends, status

router = APIRouter()


@router.post(
    "/register",
    response_model=AuthRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: UserCreate,
    _: None = Depends(require_register_secret),
    service: AuthService = Depends(get_auth_service),
):
    try:
        user, tokens = service.register(payload)
        return AuthRegisterResponse(user=service.to_user_read(user), tokens=tokens)
    except AuthServiceError as exc:
        raise_http_from_auth_error(exc)


@router.post("/login", response_model=TokenPair)
def login(
    payload: LoginRequest,
    service: AuthService = Depends(get_auth_service),
):
    try:
        return service.login(payload)
    except AuthServiceError as exc:
        raise_http_from_auth_error(exc)


@router.post("/refresh", response_model=TokenPair)
def refresh(
    payload: RefreshRequest,
    service: AuthService = Depends(get_auth_service),
):
    try:
        return service.refresh(payload.refresh_token)
    except AuthServiceError as exc:
        raise_http_from_auth_error(exc)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    payload: LogoutRequest,
    _: User = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
):
    service.logout(payload.refresh_token)


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
):
    try:
        service.change_password(current_user, payload)
    except AuthServiceError as exc:
        raise_http_from_auth_error(exc)
