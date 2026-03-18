from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import cv2

from app.config_store import load_config


def _discover_existing_sections(sections_dir: Path) -> List[int]:
    existing: List[int] = []

    for i in range(1, 5):
        clean_path = sections_dir / f"section{i}_clean.png"
        if clean_path.exists():
            existing.append(i)

    return existing


def _read_image_size(image_path: Path) -> Dict[str, int]:
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


def _load_section_zone_payload(zones_file: Path, clean_image_path: Path) -> Dict[str, Any]:
    image_size = _read_image_size(clean_image_path)
    zones: List[Dict[str, Any]] = []

    if not zones_file.exists():
        return {
            "zones": zones,
            "image_size": image_size,
            "has_zones": False,
        }

    try:
        data = json.loads(zones_file.read_text(encoding="utf-8"))
        zones = _normalize_zones(data.get("zones", []))
        image_size = data.get("image_size", image_size)
        return {
            "zones": zones,
            "image_size": image_size,
            "has_zones": True,
        }
    except Exception:
        return {
            "zones": [],
            "image_size": image_size,
            "has_zones": False,
        }


def get_part(part_id: str) -> Dict[str, Any]:
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    sections_dir = part_dir / "sections"
    zones_dir = part_dir / "zones"

    sections: List[Dict[str, Any]] = []
    missing_zones_sections: List[int] = []

    existing_sections = _discover_existing_sections(sections_dir)

    for i in existing_sections:
        clean_path = sections_dir / f"section{i}_clean.png"
        overlay_path = sections_dir / f"section{i}_overlay.png"
        zones_file = zones_dir / f"section{i}.json"

        zone_payload = _load_section_zone_payload(zones_file, clean_path)

        if not zone_payload["has_zones"]:
            missing_zones_sections.append(i)

        sections.append(
            {
                "index": i,
                "image_url": f"/parts/{part_id}/sections/section{i}_clean.png",
                "overlay_url": (
                    f"/parts/{part_id}/sections/section{i}_overlay.png"
                    if overlay_path.exists()
                    else None
                ),
                "zones": zone_payload["zones"],
                "image_size": zone_payload["image_size"],
                "has_zones": zone_payload["has_zones"],
                "has_overlay": overlay_path.exists(),
            }
        )

    configured = len(existing_sections) > 0 and len(missing_zones_sections) == 0

    return {
        "part_id": part_id,
        "display_name": part_id.replace("_", " "),
        "configured": configured,
        "missing_zones_sections": missing_zones_sections,
        "sections": sections,
        "section_count": len(sections),
    }


def scan_parts() -> List[Dict[str, Any]]:
    cfg = load_config()
    root = Path(cfg.parts_root)

    parts: List[Dict[str, Any]] = []

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

        existing_sections = _discover_existing_sections(sections_dir)

        if not existing_sections:
            configured = False
        else:
            configured = True
            for i in existing_sections:
                zone_file = zones_dir / f"section{i}.json"
                if not zone_file.exists():
                    configured = False
                    break

        parts.append(
            {
                "part_id": part_id,
                "display_name": display_name,
                "thumb_url": f"/parts/{part_id}/thumb.png",
                "sections": existing_sections,
                "section_count": len(existing_sections),
                "configured": configured,
            }
        )

    parts.sort(key=lambda p: p["display_name"].lower())
    return parts