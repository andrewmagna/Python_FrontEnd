from __future__ import annotations

from fastapi import Depends, HTTPException, Request, Response
from itsdangerous import URLSafeSerializer, BadSignature

from app.config_store import load_config

COOKIE_NAME = "zone_admin"


def _serializer() -> URLSafeSerializer:
    cfg = load_config()
    # Reuse your secret key if you have one, otherwise set SECRET_KEY env var later
    secret = getattr(cfg, "secret_key", "dev_secret_change_me")
    return URLSafeSerializer(secret, salt="admin-session")


def set_admin_cookie(resp: Response) -> None:
    token = _serializer().dumps({"admin": True})
    resp.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # set True when you serve over https
        max_age=60 * 60 * 8,  # 8 hours
    )


def clear_admin_cookie(resp: Response) -> None:
    resp.delete_cookie(COOKIE_NAME)


def is_admin(request: Request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return False
    try:
        data = _serializer().loads(token)
        return bool(data.get("admin"))
    except BadSignature:
        return False


def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="Admin login required")


def admin_dep(request: Request):
    require_admin(request)
    return True