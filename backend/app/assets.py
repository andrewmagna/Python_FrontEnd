from __future__ import annotations

from pathlib import Path
from typing import List
import re

from .config import settings

PARTS_DIR = Path(settings.assets_root) / "parts"
SECTIONS_DIR = Path(settings.assets_root) / "sections"

def prettify_part_name(name: str) -> str:
    return name.replace("_", " ")

def list_part_names() -> List[str]:
    if not PARTS_DIR.exists():
        return []
    out: List[str] = []
    for p in PARTS_DIR.glob("*.png"):
        out.append(p.stem)
    out.sort()
    return out

_SECTION_RE = re.compile(r"^section_(\d+)\.png$", re.IGNORECASE)

def list_sections_for_part(part_name: str) -> List[int]:
    part_dir = SECTIONS_DIR / part_name
    if not part_dir.exists():
        return []

    idxs: List[int] = []
    for f in part_dir.glob("section_*.png"):
        m = _SECTION_RE.match(f.name)
        if m:
            idxs.append(int(m.group(1)))

    # spec says sections 1..4
    return sorted(set(i for i in idxs if 1 <= i <= 4))

def section_image_path(part_name: str, section_index: int, annotated: bool = False) -> Path:
    part_dir = SECTIONS_DIR / part_name
    if annotated:
        return part_dir / f"section_{section_index}_annotated.png"
    return part_dir / f"section_{section_index}.png"

def part_thumbnail_path(part_name: str) -> Path:
    return PARTS_DIR / f"{part_name}.png"