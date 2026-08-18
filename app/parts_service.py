from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2

from app.config_store import load_config

_scan_parts_cache: Optional[List[Dict[str, Any]]] = None
_scan_parts_cache_ts: float = 0.0
_SCAN_PARTS_TTL: float = 5.0


def invalidate_scan_cache() -> None:
    global _scan_parts_cache
    _scan_parts_cache = None


def read_image_size(image_path: Path) -> Dict[str, int]:
    default_size = {"width": 1920, "height": 1080}

    if not image_path.exists():
        return default_size

    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is None:
        return default_size

    height, width = img.shape[:2]
    return {"width": int(width), "height": int(height)}


def _normalize_zone(zone: Dict[str, Any]) -> Dict[str, Any]:
    zone_id = zone.get("zone_id")
    points = zone.get("points", [])
    orientation = zone.get("orientation")

    if orientation not in (1, 2, 3, 4):
        orientation = None

    return {
        "zone_id": zone_id,
        "points": points,
        "orientation": orientation,
    }


def _normalize_zones(zones: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []

    for zone in zones:
        if not isinstance(zone, dict):
            continue

        zone_id = zone.get("zone_id")
        points = zone.get("points", [])

        if not isinstance(zone_id, int):
            continue

        if not isinstance(points, list) or len(points) < 3:
            continue

        normalized.append(_normalize_zone(zone))

    return normalized


def _normalize_section(section: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(section, dict):
        return None
    slot = section.get("slot")
    if not isinstance(slot, int) or slot < 1 or slot > 5:
        return None
    name = str(section.get("name") or "")
    zone_ids = section.get("zone_ids", [])
    if not isinstance(zone_ids, list):
        return None
    valid_ids = sorted({z for z in zone_ids if isinstance(z, int) and 1 <= z <= 35})
    if len(valid_ids) < 2:
        return None
    orientation = section.get("orientation")
    if orientation not in (1, 2, 3, 4):
        return None
    return {"slot": slot, "name": name, "zone_ids": valid_ids, "orientation": orientation}


def _normalize_sections(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    seen_slots: set = set()
    for s in sections:
        norm = _normalize_section(s)
        if norm is None:
            continue
        if norm["slot"] in seen_slots:
            continue
        seen_slots.add(norm["slot"])
        result.append(norm)
    return sorted(result, key=lambda s: s["slot"])


def _load_zones(zones_file: Path, image_path: Path) -> Dict[str, Any]:
    image_size = read_image_size(image_path)
    zones: List[Dict[str, Any]] = []
    sections: List[Dict[str, Any]] = []

    if not zones_file.exists():
        return {"zones": zones, "sections": sections, "image_size": image_size, "has_zones": False}

    try:
        data = json.loads(zones_file.read_text(encoding="utf-8"))
        zones = _normalize_zones(data.get("zones", []))
        sections = _normalize_sections(data.get("sections", []))
        image_size = data.get("image_size", image_size)
        return {"zones": zones, "sections": sections, "image_size": image_size, "has_zones": len(zones) > 0}
    except Exception:
        return {"zones": [], "sections": [], "image_size": image_size, "has_zones": False}


def get_part(part_id: str) -> Dict[str, Any]:
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    image_path = part_dir / "part.png"
    overlay_path = part_dir / "overlay.png"
    zones_file = part_dir / "zones.json"

    zone_payload = _load_zones(zones_file, image_path)
    configured = image_path.exists() and zone_payload["has_zones"]

    return {
        "part_id": part_id,
        "display_name": part_id.replace("_", " "),
        "configured": configured,
        "image_url": f"/parts/{part_id}/part.png",
        "overlay_url": f"/parts/{part_id}/overlay.png" if overlay_path.exists() else None,
        "has_overlay": overlay_path.exists(),
        "image_size": zone_payload["image_size"],
        "zones": zone_payload["zones"],
        "sections": zone_payload["sections"],
    }


def scan_parts() -> List[Dict[str, Any]]:
    global _scan_parts_cache, _scan_parts_cache_ts

    now = time.monotonic()
    if _scan_parts_cache is not None and (now - _scan_parts_cache_ts) < _SCAN_PARTS_TTL:
        return _scan_parts_cache

    cfg = load_config()
    root = Path(cfg.parts_root)

    parts: List[Dict[str, Any]] = []

    if not root.exists():
        return parts

    for part_dir in root.iterdir():
        if not part_dir.is_dir():
            continue

        image_path = part_dir / "part.png"
        if not image_path.exists():
            continue

        part_id = part_dir.name
        zones_file = part_dir / "zones.json"
        has_zones = False

        if zones_file.exists():
            try:
                data = json.loads(zones_file.read_text(encoding="utf-8"))
                has_zones = len(_normalize_zones(data.get("zones", []))) > 0
            except Exception:
                pass

        parts.append(
            {
                "part_id": part_id,
                "display_name": part_id.replace("_", " "),
                "image_url": f"/parts/{part_id}/part.png",
                "configured": has_zones,
            }
        )

    parts.sort(key=lambda p: p["display_name"].lower())
    _scan_parts_cache = parts
    _scan_parts_cache_ts = now
    return parts
