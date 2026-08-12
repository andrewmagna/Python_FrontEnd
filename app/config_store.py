from __future__ import annotations

import json
import os
import platform
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


APP_NAME = "ZoneSelect"
CONFIG_FILENAME = "config.json"


def default_parts_root() -> str:
    system = platform.system().lower()
    if "windows" in system:
        return r"C:\ZoneSelectParts"
    # macOS (Darwin) default
    return "/Users/Shared/ZoneSelectParts"


def app_data_dir() -> Path:
    system = platform.system().lower()

    if "windows" in system:
        appdata = os.environ.get("APPDATA")
        if not appdata:
            appdata = str(Path.home() / "AppData" / "Roaming")
        return Path(appdata) / APP_NAME

    # macOS (Darwin)
    return Path.home() / "Library" / "Application Support" / APP_NAME


def config_path() -> Path:
    return app_data_dir() / CONFIG_FILENAME


@dataclass
class AppConfig:
    parts_root: str
    admin_username: str = "admin"
    admin_password: str = "admin123"
    admin_password_hash: str = ""
    admin_password_salt: str = ""
    secret_key: str = "dev_secret_change_me"
    inactivity_timeout_minutes: int = 15

    @staticmethod
    def default() -> "AppConfig":
        return AppConfig(parts_root=default_parts_root())


_config_cache: Optional[AppConfig] = None
_config_cache_mtime: float = -1.0


def load_config() -> AppConfig:
    global _config_cache, _config_cache_mtime

    p = config_path()
    try:
        mtime = p.stat().st_mtime if p.exists() else -1.0
    except OSError:
        mtime = -1.0

    if _config_cache is not None and mtime == _config_cache_mtime:
        return _config_cache

    if not p.exists():
        cfg = AppConfig.default()
        _config_cache = cfg
        _config_cache_mtime = mtime
        return cfg

    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        parts_root = str(data.get("parts_root") or default_parts_root())
        admin_username = str(data.get("admin_username") or "admin")
        admin_password = str(data.get("admin_password") or "")
        admin_password_hash = str(data.get("admin_password_hash") or "")
        admin_password_salt = str(data.get("admin_password_salt") or "")
        secret_key = str(data.get("secret_key") or "dev_secret_change_me")
        inactivity_timeout_minutes = int(data.get("inactivity_timeout_minutes") or 15)
        cfg = AppConfig(
            parts_root=parts_root,
            admin_username=admin_username,
            admin_password=admin_password,
            admin_password_hash=admin_password_hash,
            admin_password_salt=admin_password_salt,
            secret_key=secret_key,
            inactivity_timeout_minutes=inactivity_timeout_minutes,
        )
        _config_cache = cfg
        _config_cache_mtime = mtime
        return cfg
    except Exception:
        cfg = AppConfig.default()
        _config_cache = cfg
        _config_cache_mtime = mtime
        return cfg


def save_config(cfg: AppConfig) -> None:
    global _config_cache, _config_cache_mtime

    d = app_data_dir()
    d.mkdir(parents=True, exist_ok=True)
    p = config_path()
    payload: dict = {
        "parts_root": cfg.parts_root,
        "admin_username": cfg.admin_username,
        "secret_key": cfg.secret_key,
        "inactivity_timeout_minutes": cfg.inactivity_timeout_minutes,
    }
    if cfg.admin_password:
        payload["admin_password"] = cfg.admin_password
    if cfg.admin_password_hash:
        payload["admin_password_hash"] = cfg.admin_password_hash
        payload["admin_password_salt"] = cfg.admin_password_salt
    p.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    _config_cache = cfg
    try:
        _config_cache_mtime = p.stat().st_mtime
    except OSError:
        _config_cache_mtime = -1.0


def data_root() -> Path:
    """Root directory for mutable app data (data/recipes, data/last_state, data/users).
    In frozen mode this is next to the .exe; in dev mode it is the project root."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parents[1]


def users_file_path() -> Path:
    """Canonical path to users.json — single source of truth for both main.py and admin_auth.py."""
    return data_root() / "data" / "users" / "users.json"


def validate_parts_root(path_str: str) -> Optional[str]:
    p = Path(path_str).expanduser()
    if not p.exists():
        return "Path does not exist."
    if not p.is_dir():
        return "Path is not a directory."
    return None
