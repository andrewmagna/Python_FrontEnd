from __future__ import annotations
from pathlib import Path
from typing import List, Dict, Any

from app.config_store import load_config

from pathlib import Path
import json


def get_part(part_id: str) -> Dict[str, Any]:
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    sections_dir = part_dir / "sections"
    zones_dir = part_dir / "zones"

    sections: List[Dict[str, Any]] = []
    missing: List[int] = []

    for i in range(1, 5):
        clean = sections_dir / f"section{i}_clean.png"
        if not clean.exists():
            continue

        zones_file = zones_dir / f"section{i}.json"
        zones: List[Dict[str, Any]] = []

        if zones_file.exists():
            try:
                data = json.loads(zones_file.read_text(encoding="utf-8"))
                zones = data.get("zones", [])
            except Exception:
                zones = []
        else:
            missing.append(i)

        sections.append(
            {
                "index": i,
                "image_url": f"/parts/{part_id}/sections/section{i}_clean.png",
                "zones": zones,
                "has_zones": zones_file.exists(),
            }
        )

    configured = (len(sections) > 0) and (len(missing) == 0)

    return {
        "part_id": part_id,
        "display_name": part_id.replace("_", " "),
        "configured": configured,
        "missing_zones_sections": missing,
        "sections": sections,
    }


def scan_parts() -> List[Dict[str, Any]]:
    cfg = load_config()
    root = Path(cfg.parts_root)

    parts = []

    if not root.exists():
        return parts

    for part_dir in root.iterdir():
        if not part_dir.is_dir():
            continue

        thumb = part_dir / "thumb.png"
        if not thumb.exists():
            continue

        part_id = part_dir.name
        display_name = part_id.replace("_", " ")

        sections_dir = part_dir / "sections"
        zones_dir = part_dir / "zones"

        sections = []

        for i in range(1, 5):
            clean = sections_dir / f"section{i}_clean.png"
            if clean.exists():
                sections.append(i)

        configured = True

        for i in sections:
            zone_file = zones_dir / f"section{i}.json"
            if not zone_file.exists():
                configured = False
                break

        parts.append(
            {
                "part_id": part_id,
                "display_name": display_name,
                "thumb_url": f"/parts/{part_id}/thumb.png",
                "sections": sections,
                "configured": configured,
            }
        )

    return parts