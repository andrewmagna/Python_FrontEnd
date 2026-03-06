import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List

from app.config_store import app_data_dir


def db_path() -> Path:
    d = app_data_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / "audit.sqlite3"


def init_db() -> None:
    with sqlite3.connect(db_path()) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS apply_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL,
              part_id TEXT NOT NULL,
              selected_zones TEXT NOT NULL,
              zone_states TEXT NOT NULL
            )
            """
        )
        conn.commit()


def log_apply(part_id: str, zone_states: Dict[str, Any]) -> None:
    selected: List[int] = []
    for k, v in zone_states.items():
        if v:
            selected.append(int(k))
    selected.sort()

    payload_states = json.dumps(zone_states, separators=(",", ":"))
    payload_selected = json.dumps(selected, separators=(",", ":"))
    ts = datetime.now().isoformat(timespec="seconds")

    with sqlite3.connect(db_path()) as conn:
        conn.execute(
            "INSERT INTO apply_log(ts, part_id, selected_zones, zone_states) VALUES(?,?,?,?)",
            (ts, part_id, payload_selected, payload_states),
        )
        conn.commit()