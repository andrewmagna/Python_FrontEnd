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
    admin_password: str = "admin123"

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
        return AppConfig(parts_root=parts_root)
    except Exception:
        # Corrupt config, fall back to default instead of bricking the app
        return AppConfig.default()


def save_config(cfg: AppConfig) -> None:
    d = app_data_dir()
    d.mkdir(parents=True, exist_ok=True)
    p = config_path()
    payload = {"parts_root": cfg.parts_root}
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