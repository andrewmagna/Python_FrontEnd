from __future__ import annotations

import json
import os
import platform
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
            # Fallback, should be rare, but Windows loves surprises
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
    secret_key: str = "dev_secret_change_me"
    inactivity_timeout_minutes: int = 15

    @staticmethod
    def default() -> "AppConfig":
        return AppConfig(parts_root=default_parts_root())


def load_config() -> AppConfig:
    p = config_path()
    if not p.exists():
        return AppConfig.default()

    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        parts_root = str(data.get("parts_root") or default_parts_root())
        admin_username = str(data.get("admin_username") or "admin")
        admin_password = str(data.get("admin_password") or "admin123")
        secret_key = str(data.get("secret_key") or "dev_secret_change_me")
        inactivity_timeout_minutes = int(data.get("inactivity_timeout_minutes") or 15)
        return AppConfig(
            parts_root=parts_root,
            admin_username=admin_username,
            admin_password=admin_password,
            secret_key=secret_key,
            inactivity_timeout_minutes=inactivity_timeout_minutes,
        )
    except Exception:
        # Corrupt config, fall back to default instead of bricking the app
        return AppConfig.default()


def save_config(cfg: AppConfig) -> None:
    d = app_data_dir()
    d.mkdir(parents=True, exist_ok=True)
    p = config_path()
    payload = {
        "parts_root": cfg.parts_root,
        "admin_username": cfg.admin_username,
        "admin_password": cfg.admin_password,
        "secret_key": cfg.secret_key,
        "inactivity_timeout_minutes": cfg.inactivity_timeout_minutes,
    }
    p.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def validate_parts_root(path_str: str) -> Optional[str]:
    """
    Returns None if OK, else returns an error message.
    We keep validation light for v1.
    """
    p = Path(path_str).expanduser()
    if not p.exists():
        return "Path does not exist."
    if not p.is_dir():
        return "Path is not a directory."
    # Optional: allow empty folder, user may set up later.
    return None