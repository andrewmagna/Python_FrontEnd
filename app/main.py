from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import cv2
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.admin_auth import admin_dep, clear_admin_cookie, is_admin, set_admin_cookie
from app.audit import init_db, log_apply
from app.config_store import AppConfig, load_config, save_config, validate_parts_root
from app.opc_service import (
    connect,
    write_zones,
    is_connected,
    get_table_orientation,
    get_table_orientation_degrees,
    get_paths,
)
from app.overlay_import import import_polygons_from_overlay
from app.parts_service import get_part, scan_parts


@asynccontextmanager
async def lifespan(app: FastAPI):
    connect()
    init_db()
    yield


app = FastAPI(title="ZoneSelect", lifespan=lifespan)

cfg = load_config()
parts_root = Path(cfg.parts_root)

RECIPES_ROOT = Path("data/recipes")
RECIPES_ROOT.mkdir(parents=True, exist_ok=True)

if parts_root.exists():
    app.mount("/parts", StaticFiles(directory=parts_root), name="parts")


class ConfigResponse(BaseModel):
    parts_root: str


class ConfigUpdateRequest(BaseModel):
    parts_root: str


class ApplyRequest(BaseModel):
    part_id: str
    zones: dict


class WritePathsRequest(BaseModel):
    paths: list


class AdminLoginRequest(BaseModel):
    password: str


class EditorSectionResponse(BaseModel):
    part_id: str
    section_index: int
    image_url: str
    image_size: dict
    zones: list


class EditorSaveRequest(BaseModel):
    image: str
    image_size: dict
    zones: list


class SaveRecipeRequest(BaseModel):
    name: str
    description: Optional[str] = None
    paths: list
    zones: dict


class LoadRecipeRequest(BaseModel):
    recipe_id: int
    
class UpdateRecipeRequest(BaseModel):
    name: str
    description: Optional[str] = None
    paths: list
    zones: dict


def _discover_existing_sections(part_dir: Path) -> list[int]:
    sections_dir = part_dir / "sections"
    existing: list[int] = []

    for i in range(1, 5):
        clean_path = sections_dir / f"section{i}_clean.png"
        if clean_path.exists():
            existing.append(i)

    return existing


def _ensure_existing_section(part_dir: Path, section_index: int) -> Path:
    image_path = part_dir / "sections" / f"section{section_index}_clean.png"
    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"Section {section_index} image not found")
    return image_path


def _read_image_size(image_path: Path) -> dict[str, int]:
    default_size = {"width": 1920, "height": 1080}

    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is None:
        return default_size

    height, width = img.shape[:2]
    return {"width": int(width), "height": int(height)}


def _normalize_zone_for_response(zone: dict[str, Any]) -> dict[str, Any]:
    orientation = zone.get("orientation")
    if orientation not in (1, 2, 3, 4):
        orientation = None

    return {
        "zone_id": zone.get("zone_id"),
        "points": zone.get("points", []),
        "orientation": orientation,
    }


@app.get("/api/admin/status")
def admin_status(request: Request):
    return {"admin": is_admin(request)}


@app.post("/api/admin/login")
def admin_login(req: AdminLoginRequest, response: Response):
    cfg = load_config()
    expected = getattr(cfg, "admin_password", "change_me")

    if req.password != expected:
        raise HTTPException(status_code=401, detail="Invalid password")

    set_admin_cookie(response)
    return {"ok": True}


@app.post("/api/admin/logout")
def admin_logout(response: Response):
    clear_admin_cookie(response)
    return {"ok": True}


@app.get("/api/config", response_model=ConfigResponse)
def get_config() -> ConfigResponse:
    cfg = load_config()
    return ConfigResponse(parts_root=cfg.parts_root)


@app.post("/api/config", response_model=ConfigResponse)
def set_config(req: ConfigUpdateRequest) -> ConfigResponse:
    err = validate_parts_root(req.parts_root)
    if err is not None:
        raise HTTPException(status_code=400, detail=err)

    cfg = AppConfig(parts_root=req.parts_root)
    save_config(cfg)
    return ConfigResponse(parts_root=cfg.parts_root)


@app.get("/api/parts")
def get_parts():
    return scan_parts()


@app.get("/api/parts/{part_id}")
def part_detail(part_id: str):
    return get_part(part_id)


@app.post("/api/apply")
def apply(req: ApplyRequest):
    if not is_connected():
        raise HTTPException(status_code=500, detail="OPC UA not connected")

    write_zones(req.part_id, req.zones)
    log_apply(req.part_id, req.zones)

    return {"status": "ok"}


@app.post("/api/opc/write-paths")
def write_paths_endpoint(req: WritePathsRequest):
    from app.opc_service import write_paths

    if not is_connected():
        raise HTTPException(status_code=500, detail="OPC UA not connected")

    write_paths(req.paths)

    return {"status": "ok"}


def load_section_zones(zones_path: Path) -> list[dict[str, Any]]:
    if not zones_path.exists():
        return []

    try:
        data = json.loads(zones_path.read_text(encoding="utf-8"))
        zones = data.get("zones", [])
        return [z for z in zones if isinstance(z, dict)]
    except Exception:
        return []


def collect_part_zone_ids(part_dir: Path, exclude_section_index: int | None = None) -> dict[str, Any]:
    zones_dir = part_dir / "zones"
    used_ids: set[int] = set()
    by_section: dict[int, list[int]] = {}

    existing_sections = _discover_existing_sections(part_dir)

    for i in existing_sections:
        if exclude_section_index is not None and i == exclude_section_index:
            continue

        section_file = zones_dir / f"section{i}.json"
        zones = load_section_zones(section_file)
        ids: list[int] = []

        for z in zones:
            zone_id = z.get("zone_id")
            if isinstance(zone_id, int):
                ids.append(zone_id)
                used_ids.add(zone_id)

        if ids:
            by_section[i] = sorted(ids)

    return {
        "used_ids": sorted(used_ids),
        "by_section": by_section,
    }
    
def _recipe_file(part_id: str) -> Path:
    return RECIPES_ROOT / f"{part_id}.json"


def _load_recipe_list(part_id: str) -> list[dict[str, Any]]:
    path = _recipe_file(part_id)
    if not path.exists():
        return []

    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_recipe_list(part_id: str, recipes: list[dict[str, Any]]) -> None:
    path = _recipe_file(part_id)
    path.write_text(json.dumps(recipes, indent=2))


# Helper to compare recipe IDs safely
def _recipe_id_matches(recipe: dict[str, Any], recipe_id: int) -> bool:
    try:
        return int(recipe.get("id", -1)) == recipe_id
    except Exception:
        return False



@app.get("/api/editor/parts/{part_id}/sections/{section_index}", dependencies=[Depends(admin_dep)])
def editor_get_section(part_id: str, section_index: int):
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    if not part_dir.exists():
        raise HTTPException(status_code=404, detail="Part not found")

    image_path = _ensure_existing_section(part_dir, section_index)
    zones_path = part_dir / "zones" / f"section{section_index}.json"

    zones_payload = {
        "image": image_path.name,
        "image_size": _read_image_size(image_path),
        "zones": [],
    }

    if zones_path.exists():
        try:
            loaded = json.loads(zones_path.read_text(encoding="utf-8"))
            raw_zones = loaded.get("zones", [])
            zones_payload = {
                "image": loaded.get("image", image_path.name),
                "image_size": loaded.get("image_size", _read_image_size(image_path)),
                "zones": [
                    _normalize_zone_for_response(z)
                    for z in raw_zones
                    if isinstance(z, dict)
                ],
            }
        except Exception:
            pass

    part_usage = collect_part_zone_ids(part_dir, exclude_section_index=section_index)
    current_section_ids = sorted(
        [
            z.get("zone_id")
            for z in zones_payload.get("zones", [])
            if isinstance(z.get("zone_id"), int)
        ]
    )

    mtime = int(image_path.stat().st_mtime)

    return {
        "part_id": part_id,
        "section_index": section_index,
        "image_url": f"/parts/{part_id}/sections/section{section_index}_clean.png?v={mtime}",
        "image_size": zones_payload.get("image_size", _read_image_size(image_path)),
        "zones": zones_payload.get("zones", []),
        "part_used_zone_ids_other_sections": part_usage["used_ids"],
        "section_used_zone_ids": current_section_ids,
        "zone_ids_by_other_section": part_usage["by_section"],
    }


@app.post("/api/editor/parts/{part_id}/sections/{section_index}", dependencies=[Depends(admin_dep)])
def editor_save_section(part_id: str, section_index: int, req: EditorSaveRequest):
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    if not part_dir.exists():
        raise HTTPException(status_code=404, detail="Part not found")

    image_path = _ensure_existing_section(part_dir, section_index)

    zones_dir = part_dir / "zones"
    zones_dir.mkdir(parents=True, exist_ok=True)
    zones_path = zones_dir / f"section{section_index}.json"

    current_ids: list[int] = []
    cleaned_zones: list[dict[str, Any]] = []

    for z in req.zones:
        if not isinstance(z, dict):
            raise HTTPException(status_code=400, detail="Each zone must be an object")

        zone_id = z.get("zone_id")
        points = z.get("points", [])
        orientation = z.get("orientation")

        if not isinstance(zone_id, int):
            raise HTTPException(status_code=400, detail="Each zone must have an integer zone_id")

        if zone_id < 1 or zone_id > 40:
            raise HTTPException(
                status_code=400,
                detail=f"Zone ID {zone_id} is out of range (1..40)",
            )

        if not isinstance(points, list) or len(points) < 3:
            raise HTTPException(
                status_code=400,
                detail=f"Zone {zone_id} must have at least 3 points",
            )

        cleaned_points: list[list[int]] = []
        for pt in points:
            if (
                not isinstance(pt, list)
                or len(pt) != 2
                or not isinstance(pt[0], (int, float))
                or not isinstance(pt[1], (int, float))
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"Zone {zone_id} contains an invalid point",
                )
            cleaned_points.append([round(pt[0]), round(pt[1])])

        if orientation is not None and orientation not in (1, 2, 3, 4):
            raise HTTPException(
                status_code=400,
                detail=f"Zone {zone_id} has an invalid orientation",
            )

        current_ids.append(zone_id)
        cleaned_zones.append(
            {
                "zone_id": zone_id,
                "points": cleaned_points,
                "orientation": orientation,
            }
        )

    if len(current_ids) != len(set(current_ids)):
        raise HTTPException(status_code=400, detail="Duplicate zone IDs exist within this section")

    part_usage = collect_part_zone_ids(part_dir, exclude_section_index=section_index)
    other_used_ids = set(part_usage["used_ids"])
    conflicts = sorted(set(current_ids).intersection(other_used_ids))

    if conflicts:
        raise HTTPException(
            status_code=400,
            detail=f"Zone IDs already used in other sections of this part: {conflicts}",
        )

    payload = {
        "image": req.image or image_path.name,
        "image_size": req.image_size or _read_image_size(image_path),
        "zones": cleaned_zones,
    }

    zones_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    return {"ok": True}


@app.post("/api/editor/parts/{part_id}/sections/{section_index}/import", dependencies=[Depends(admin_dep)])
def editor_import_overlay(part_id: str, section_index: int):
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    if not part_dir.exists():
        raise HTTPException(status_code=404, detail="Part not found")

    overlay_path = part_dir / "sections" / f"section{section_index}_overlay.png"
    clean_path = _ensure_existing_section(part_dir, section_index)

    try:
        result = import_polygons_from_overlay(overlay_path, clean_path=clean_path)

        clean_img = cv2.imread(str(clean_path), cv2.IMREAD_COLOR)
        if clean_img is None:
            raise HTTPException(status_code=500, detail="Failed to load clean section image")

        clean_height, clean_width = clean_img.shape[:2]

        imported_zones = []
        for zone in result.get("zones", []):
            if not isinstance(zone, dict):
                continue

            zone_id = zone.get("zone_id")
            points = zone.get("points", [])

            if not isinstance(zone_id, int):
                continue
            if not isinstance(points, list) or len(points) < 3:
                continue

            imported_zones.append(
                {
                    "zone_id": zone_id,
                    "points": [[round(p[0]), round(p[1])] for p in points],
                    "orientation": None,
                }
            )

        return {
            "image_size": {"width": clean_width, "height": clean_height},
            "zones": imported_zones,
            "debug": result.get("debug", {}),
        }

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")


@app.get("/api/recipes/{part_id}")
def get_recipes(part_id: str):
    return _load_recipe_list(part_id)


@app.post("/api/recipes/{part_id}/save")
def save_recipe(part_id: str, req: SaveRecipeRequest):
    existing = _load_recipe_list(part_id)

    next_id = max(
        (int(r.get("id", 0)) for r in existing if isinstance(r, dict)),
        default=0,
    ) + 1

    new_recipe = {
        "id": next_id,
        "name": req.name,
        "description": req.description,
        "paths": req.paths,
        "zones": req.zones,
    }

    existing.append(new_recipe)
    _save_recipe_list(part_id, existing)

    return {"ok": True, "recipe": new_recipe}


@app.post("/api/recipes/{part_id}/load")
def load_recipe(part_id: str, req: LoadRecipeRequest):
    recipes = _load_recipe_list(part_id)

    recipe = next((r for r in recipes if _recipe_id_matches(r, req.recipe_id)), None)

    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    if not is_connected():
        raise HTTPException(status_code=409, detail="OPC not connected")

    from app.opc_service import write_paths

    write_paths(recipe.get("paths", []))
    write_zones(part_id, recipe.get("zones", {}))

    return recipe

@app.put("/api/admin/recipes/{part_id}/{recipe_id}", dependencies=[Depends(admin_dep)])
def update_recipe(part_id: str, recipe_id: int, req: UpdateRecipeRequest):
    recipes = _load_recipe_list(part_id)

    updated_recipe = None
    for recipe in recipes:
        if _recipe_id_matches(recipe, recipe_id):
            recipe["name"] = req.name
            recipe["description"] = req.description
            recipe["paths"] = req.paths
            recipe["zones"] = req.zones
            updated_recipe = recipe
            break

    if updated_recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")

    _save_recipe_list(part_id, recipes)
    return {"ok": True, "recipe": updated_recipe}


@app.delete("/api/admin/recipes/{part_id}/{recipe_id}", dependencies=[Depends(admin_dep)])
def delete_recipe(part_id: str, recipe_id: int):
    recipes = _load_recipe_list(part_id)
    filtered = [r for r in recipes if not _recipe_id_matches(r, recipe_id)]

    if len(filtered) == len(recipes):
        raise HTTPException(status_code=404, detail="Recipe not found")

    _save_recipe_list(part_id, filtered)
    return {"ok": True}


@app.get("/api/opc/force")
def opc_force():
    from app.opc_service import get_force_reading

    value = get_force_reading()

    return {"value": value}


@app.get("/api/opc/paths")
def opc_paths():
    return {"paths": get_paths()}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/opc/status")
def opc_status():
    orientation = get_table_orientation()
    orientation_degrees = get_table_orientation_degrees()

    return {
        "connected": is_connected(),
        "table_orientation": orientation,
        "table_orientation_degrees": orientation_degrees,
    }