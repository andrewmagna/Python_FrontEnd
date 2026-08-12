from __future__ import annotations

import json

from fastapi import HTTPException, Request, Response
from itsdangerous import BadSignature, URLSafeSerializer

from app.config_store import load_config, users_file_path

COOKIE_NAME = "zone_session"

_users_cache: list | None = None
_users_cache_mtime: float = -1.0


def _load_users_for_validation() -> list:
    global _users_cache, _users_cache_mtime
    p = users_file_path()
    try:
        mtime = p.stat().st_mtime if p.exists() else -1.0
    except OSError:
        mtime = -1.0
    if _users_cache is not None and mtime == _users_cache_mtime:
        return _users_cache
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        result = data if isinstance(data, list) else []
    except Exception:
        result = []
    _users_cache = result
    _users_cache_mtime = mtime
    return result


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
        if not isinstance(data, dict):
            return None
    except BadSignature:
        return None

    # Validate operator/supervisor sessions against the current users file.
    # Admin sessions have no user_id and are config-based — they pass through.
    user_id = data.get("user_id")
    if user_id is not None:
        stored_role = data.get("role")
        for user in _load_users_for_validation():
            if user.get("id") == user_id:
                if user.get("role") != stored_role:
                    return None  # role changed
                return data
        return None  # user deleted

    return data


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