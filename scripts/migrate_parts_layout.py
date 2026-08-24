#!/usr/bin/env python3
"""
Migrate parts folder layout from multi-section to flat single-image layout.

Old layout:
  <Part_Id>/
    thumb.png
    sections/section1_clean.png  [section2..4 if present]
    sections/section1_overlay.png  [optional]
    zones/section1.json  [one per section]

New layout:
  <Part_Id>/
    part.png        (was sections/section1_clean.png)
    overlay.png     (was sections/section1_overlay.png, if present)
    zones.json      (was zones/section1.json, "image" field rewritten to "part.png")

Usage:
    python scripts/migrate_parts_layout.py <parts_root> [--dry-run] [--no-backup]
"""

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path


def find_section_images(sections_dir: Path) -> list[int]:
    found = []
    for i in range(1, 5):
        if (sections_dir / f"section{i}_clean.png").exists():
            found.append(i)
    return found


def migrate_part(part_dir: Path, dry_run: bool) -> tuple[str, list[str]]:
    """
    Returns (status, warnings).
    status: "migrated" | "skipped" | "warning"
    """
    part_id = part_dir.name
    warnings: list[str] = []

    # Already migrated: has part.png and no sections/ dir
    if (part_dir / "part.png").exists() and not (part_dir / "sections").exists():
        return "skipped", []

    sections_dir = part_dir / "sections"
    zones_dir = part_dir / "zones"

    existing_sections = find_section_images(sections_dir)

    if not existing_sections:
        warnings.append(
            f"  WARNING [{part_id}]: no section images found in {sections_dir} — skipping"
        )
        return "warning", warnings

    if len(existing_sections) > 1:
        extra = existing_sections[1:]
        extra_files = [str(sections_dir / f"section{i}_clean.png") for i in extra]
        warnings.append(
            f"  WARNING [{part_id}]: has {len(existing_sections)} image sections "
            f"(sections {existing_sections}). Extra section files: {extra_files}. "
            "Skipping this part — migrate manually."
        )
        return "warning", warnings

    section_idx = existing_sections[0]
    clean_src = sections_dir / f"section{section_idx}_clean.png"
    overlay_src = sections_dir / f"section{section_idx}_overlay.png"
    zones_src = zones_dir / f"section{section_idx}.json"

    part_png = part_dir / "part.png"
    overlay_png = part_dir / "overlay.png"
    zones_json = part_dir / "zones.json"
    thumb_png = part_dir / "thumb.png"

    actions: list[str] = []

    # Rename clean image -> part.png
    actions.append(f"  rename  {clean_src.relative_to(part_dir.parent)} -> {part_png.relative_to(part_dir.parent)}")

    # Rename overlay if present
    if overlay_src.exists():
        actions.append(f"  rename  {overlay_src.relative_to(part_dir.parent)} -> {overlay_png.relative_to(part_dir.parent)}")

    # Migrate zones.json
    if zones_src.exists():
        actions.append(f"  migrate {zones_src.relative_to(part_dir.parent)} -> {zones_json.relative_to(part_dir.parent)} (image field -> 'part.png')")
    else:
        actions.append(f"  note    no zones file at {zones_src.relative_to(part_dir.parent)} — zones.json will not be created")

    # Delete thumb.png
    if thumb_png.exists():
        actions.append(f"  delete  {thumb_png.relative_to(part_dir.parent)}")

    # Remove now-empty sections/ and zones/ dirs
    actions.append(f"  rmdir   {sections_dir.relative_to(part_dir.parent)} (after emptying)")
    if zones_dir.exists():
        actions.append(f"  rmdir   {zones_dir.relative_to(part_dir.parent)} (after emptying)")

    for line in actions:
        print(line)

    if dry_run:
        return "migrated", warnings

    # --- Perform the migration ---
    # 1. Copy clean image -> part.png
    shutil.copy2(clean_src, part_png)
    clean_src.unlink()

    # 2. Copy overlay if present
    if overlay_src.exists():
        shutil.copy2(overlay_src, overlay_png)
        overlay_src.unlink()

    # 3. Migrate zones JSON
    if zones_src.exists():
        try:
            data = json.loads(zones_src.read_text(encoding="utf-8"))
            data["image"] = "part.png"
            zones_json.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception as e:
            warnings.append(f"  WARNING [{part_id}]: failed to parse {zones_src}: {e}")
        zones_src.unlink()

    # 4. Delete thumb.png
    if thumb_png.exists():
        thumb_png.unlink()

    # 5. Remove sections/ dir if now empty
    try:
        sections_dir.rmdir()
    except OSError:
        remaining = list(sections_dir.iterdir())
        if remaining:
            warnings.append(
                f"  WARNING [{part_id}]: sections/ not empty after migration, "
                f"leftover: {[f.name for f in remaining]}"
            )

    # 6. Remove zones/ dir if now empty
    if zones_dir.exists():
        try:
            zones_dir.rmdir()
        except OSError:
            remaining = list(zones_dir.iterdir())
            if remaining:
                warnings.append(
                    f"  WARNING [{part_id}]: zones/ not empty after migration, "
                    f"leftover: {[f.name for f in remaining]}"
                )

    return "migrated", warnings


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate parts folder to flat layout")
    parser.add_argument("parts_root", help="Path to the parts root directory")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without modifying files")
    parser.add_argument("--no-backup", action="store_true", help="Skip backup of parts_root before migrating")
    args = parser.parse_args()

    parts_root = Path(args.parts_root).resolve()
    if not parts_root.exists() or not parts_root.is_dir():
        print(f"ERROR: parts_root '{parts_root}' does not exist or is not a directory", file=sys.stderr)
        sys.exit(1)

    part_dirs = sorted(
        [d for d in parts_root.iterdir() if d.is_dir()],
        key=lambda d: d.name.lower(),
    )

    if not part_dirs:
        print("No subdirectories found in parts_root — nothing to migrate.")
        sys.exit(0)

    # Backup
    if not args.dry_run and not args.no_backup:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = parts_root.parent / f"{parts_root.name}_backup_{timestamp}"
        print(f"Backing up {parts_root} -> {backup_path} ...")
        shutil.copytree(parts_root, backup_path)
        print(f"Backup complete: {backup_path}\n")
    elif args.dry_run:
        print("DRY RUN — no files will be modified.\n")

    n_migrated = 0
    n_skipped = 0
    all_warnings: list[str] = []

    for part_dir in part_dirs:
        print(f"[{part_dir.name}]")
        status, warnings = migrate_part(part_dir, dry_run=args.dry_run)
        all_warnings.extend(warnings)

        if status == "migrated":
            n_migrated += 1
            print(f"  -> {'(dry-run) would migrate' if args.dry_run else 'migrated'}")
        elif status == "skipped":
            n_skipped += 1
            print("  -> already migrated, skipped")
        elif status == "warning":
            print("  -> SKIPPED (see warnings)")

        print()

    print("=" * 60)
    print(f"Summary: migrated={n_migrated}, skipped={n_skipped}, warnings={len(all_warnings)}")
    if all_warnings:
        print("\nWarnings:")
        for w in all_warnings:
            print(w)


if __name__ == "__main__":
    main()
