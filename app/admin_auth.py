from __future__ import annotations

from fastapi import HTTPException, Request, Response
from itsdangerous import BadSignature, URLSafeSerializer

from app.config_store import load_config

COOKIE_NAME = "zone_session"


def _serializer() -> URLSafeSerializer:
    cfg = load_config()
    secret = getattr(cfg, "secret_key", "dev_secret_change_me")
    return URLSafeSerializer(secret, salt="zone-session")


def set_session_cookie(resp: Response, session_data: dict) -> None:
    cfg = load_config()
    max_age = int(getattr(cfg, "inactivity_timeout_minutes", 15)) * 60
    token = _serializer().dumps(session_data)
    resp.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=max_age,
    )


def clear_session_cookie(resp: Response) -> None:
    resp.delete_cookie(COOKIE_NAME)


def get_session(request: Request) -> dict | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        data = _serializer().loads(token)
        return data if isinstance(data, dict) else None
    except BadSignature:
        return None


def is_authenticated(request: Request) -> bool:
    return get_session(request) is not None


def get_current_user(request: Request) -> dict:
    session = get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Login required")
    return session


def get_current_role(request: Request) -> str | None:
    session = get_session(request)
    if not session:
        return None
    role = session.get("role")
    return role if isinstance(role, str) else None


def is_admin(request: Request) -> bool:
    return get_current_role(request) == "admin"


def require_roles(request: Request, allowed_roles: set[str]) -> dict:
    session = get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Login required")

    role = session.get("role")
    if role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    return session


def admin_dep(request: Request):
    return require_roles(request, {"admin"})


def supervisor_or_admin_dep(request: Request):
    return require_roles(request, {"admin", "supervisor"})


def any_user_dep(request: Request):
    return require_roles(request, {"admin", "supervisor", "operator"})