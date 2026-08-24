from __future__ import annotations

import json
import threading
from typing import Dict, Iterable

from app.config_store import data_root

MIN_PART_ID = 1
MAX_PART_ID = 32767

_lock = threading.Lock()


def part_ids_file():
    return data_root() / "data" / "part_ids.json"


def load_part_ids() -> Dict[str, int]:
    path = part_ids_file()
    if not path.exists():
        return {}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    if not isinstance(data, dict):
        return {}

    result: Dict[str, int] = {}
    used: set = set()
    for key, value in data.items():
        try:
            numeric = int(value)
        except Exception:
            continue
        if numeric < MIN_PART_ID or numeric > MAX_PART_ID or numeric in used:
            continue
        result[str(key)] = numeric
        used.add(numeric)
    return result


def save_part_ids(mapping: Dict[str, int]) -> None:
    path = part_ids_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(mapping, indent=2, sort_keys=True), encoding="utf-8")


def _smallest_free_id(used: set) -> int:
    candidate = MIN_PART_ID
    while candidate in used:
        candidate += 1
    if candidate > MAX_PART_ID:
        raise ValueError(f"No free part IDs left ({MIN_PART_ID}..{MAX_PART_ID} exhausted)")
    return candidate


def ensure_part_ids(folder_names: Iterable[str], remove_missing: bool = True) -> Dict[str, int]:
    """Assign the smallest free id to every folder without an entry (in sorted
    folder-name order). Entries for vanished folders are dropped only when the
    caller confirms the scan succeeded (remove_missing=True); transient scan
    errors must not wipe the registry."""
    with _lock:
        mapping = load_part_ids()
        changed = False
        folders = sorted({str(name) for name in folder_names})

        # An empty folder list looks like a transient/misconfigured root, not
        # a genuine "all parts removed" state — never mass-delete on it.
        if remove_missing and folders:
            folder_set = set(folders)
            for name in list(mapping):
                if name not in folder_set:
                    del mapping[name]
                    changed = True

        used = set(mapping.values())
        for name in folders:
            if name not in mapping:
                new_id = _smallest_free_id(used)
                mapping[name] = new_id
                used.add(new_id)
                changed = True

        if changed:
            save_part_ids(mapping)
        return mapping


def get_part_id(part_id_str: str) -> int:
    return load_part_ids().get(str(part_id_str), 0)


def set_part_id(part_id_str: str, numeric_id: int) -> None:
    with _lock:
        mapping = load_part_ids()
        mapping[str(part_id_str)] = int(numeric_id)
        save_part_ids(mapping)


def assign_new_part_id(part_id_str: str) -> int:
    with _lock:
        mapping = load_part_ids()
        existing = mapping.get(str(part_id_str))
        if existing is not None:
            return existing
        new_id = _smallest_free_id(set(mapping.values()))
        mapping[str(part_id_str)] = new_id
        save_part_ids(mapping)
        return new_id


def remove_part_id(part_id_str: str) -> None:
    with _lock:
        mapping = load_part_ids()
        if str(part_id_str) in mapping:
            del mapping[str(part_id_str)]
            save_part_ids(mapping)
