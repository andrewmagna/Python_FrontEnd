from __future__ import annotations

import json
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import cv2
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.admin_auth import (
    admin_dep,
    any_user_dep,
    clear_session_cookie,
    get_session,
    set_session_cookie,
    supervisor_or_admin_dep,
)
from app.audit import init_db, log_apply
from app.config_store import AppConfig, load_config, save_config, validate_parts_root
from app.opc_service import (
    connect,
    start_reconnect_loop,
    write_zones,
    write_paths,
    is_connected,
    get_table_orientation,
    get_table_orientation_degrees,
    get_paths,
    write_user_name,
    write_part_name,
    write_recipe_name,
    write_zone_list,
    write_shift_start_time,
    write_shift_end_time,
    write_shift_completed,
    get_program_tags,
)
from app.overlay_import import import_polygons_from_overlay
from app.parts_service import get_part, scan_parts, invalidate_scan_cache, read_image_size


@asynccontextmanager
async def lifespan(_: FastAPI):
    connect()
    start_reconnect_loop()
    init_db()
    yield


app = FastAPI(title="ZoneSelect", lifespan=lifespan)

if getattr(sys, "frozen", False):
    # Read-only bundled assets (web/dist) live in the temp extraction dir.
    # Mutable data lives next to the .exe so it persists across runs.
    _BUNDLE_ROOT = Path(sys._MEIPASS)
    _DATA_ROOT = Path(sys.executable).parent
else:
    _BUNDLE_ROOT = Path(__file__).resolve().parents[1]
    _DATA_ROOT = Path(__file__).resolve().parents[1]

WEB_DIST = _BUNDLE_ROOT / "web" / "dist"
WEB_INDEX = WEB_DIST / "index.html"

RECIPES_ROOT = _DATA_ROOT / "data" / "recipes"
RECIPES_ROOT.mkdir(parents=True, exist_ok=True)

LAST_STATE_ROOT = _DATA_ROOT / "data" / "last_state"
LAST_STATE_ROOT.mkdir(parents=True, exist_ok=True)

USERS_ROOT = _DATA_ROOT / "data" / "users"
USERS_ROOT.mkdir(parents=True, exist_ok=True)
USERS_FILE = USERS_ROOT / "users.json"

# On first run after install, seed persistent data from bundled defaults.
if getattr(sys, "frozen", False):
    import shutil as _shutil
    _bundled_data = _BUNDLE_ROOT / "data"
    for _src in _bundled_data.rglob("*"):
        if _src.is_file():
            _rel = _src.relative_to(_bundled_data)
            _dst = _DATA_ROOT / "data" / _rel
            if not _dst.exists():
                _dst.parent.mkdir(parents=True, exist_ok=True)
                _shutil.copy2(_src, _dst)

if not USERS_FILE.exists():
    USERS_FILE.write_text("[]", encoding="utf-8")

if (WEB_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")


class ConfigResponse(BaseModel):
    parts_root: str


class ConfigUpdateRequest(BaseModel):
    parts_root: str


class ApplyRequest(BaseModel):
    part_id: str
    zones: dict


class WritePathsRequest(BaseModel):
    paths: list


class SelectPartRequest(BaseModel):
    part_id: str
    display_name: str


class AdminLoginRequest(BaseModel):
    username: str
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

class SaveLastStateRequest(BaseModel):
    orientation: Optional[int] = None
    zones: dict
    paths: list
    selected_recipe_id: Optional[int] = None
    saved_at: Optional[int] = None
    
class RFIDLoginRequest(BaseModel):
    card_id: str


class UserUpsertRequest(BaseModel):
    display_name: str
    role: str
    card_id: str

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
    session = get_session(request)
    return {
        "admin": bool(session and session.get("role") == "admin"),
        "authenticated": bool(session),
        "user": session,
    }

 
@app.post("/api/admin/login")
def admin_login(req: AdminLoginRequest, response: Response):
    cfg = load_config()
    expected_username = getattr(cfg, "admin_username", "admin")
    expected_password = getattr(cfg, "admin_password", "change_me")

    if req.username != expected_username or req.password != expected_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    set_session_cookie(
        response,
        {
            "display_name": expected_username,
            "role": "admin",
            "card_id": None,
        },
    )
    if is_connected():
        try:
            write_user_name("Admin")
        except Exception as e:
            print("Failed writing UserName on admin login:", e)

    if is_connected():
        try:
            write_shift_start_time(_now_shift_timestamp())
        except Exception as e:
            print("Failed writing Shift_Start_Time on admin login:", e)

    return {"ok": True}

@app.post("/api/logout")
def logout(response: Response):
    if is_connected():
        try:
            write_shift_end_time(_now_shift_timestamp())
        except Exception as e:
            print("Failed writing Shift_End_Time on logout:", e)

        threading.Thread(target=_pulse_shift_completed_tag, daemon=True).start()

    clear_session_cookie(response)
    return {"ok": True}

@app.get("/api/session")
def session_status(request: Request, response: Response):
    session = get_session(request)
    if not session:
        return {"authenticated": False, "user": None}

    set_session_cookie(response, session)
    cfg = load_config()
    return {
        "authenticated": True,
        "user": session,
        "inactivity_timeout_minutes": cfg.inactivity_timeout_minutes,
    }


@app.post("/api/login/rfid")
def login_rfid(req: RFIDLoginRequest, response: Response):
    card_id = str(req.card_id).strip()
    if not card_id:
        raise HTTPException(status_code=400, detail="Card ID is required")

    user = _find_user_by_card(card_id)
    if not user:
        raise HTTPException(status_code=401, detail="Card not recognized")

    session_payload = {
        "user_id": user.get("id"),
        "display_name": user.get("display_name"),
        "role": user.get("role"),
        "card_id": user.get("card_id"),
    }
    set_session_cookie(response, session_payload)
    if is_connected():
        try:
            write_user_name(str(user.get("display_name") or ""))
        except Exception as e:
            print("Failed writing UserName on RFID login:", e)

    if is_connected():
        try:
            write_shift_start_time(_now_shift_timestamp())
        except Exception as e:
            print("Failed writing Shift_Start_Time on RFID login:", e)

    return {"ok": True, "user": session_payload}


@app.get("/api/users", dependencies=[Depends(supervisor_or_admin_dep)])
def get_users():
    users = [_sanitize_user(user) for user in _load_users()]
    users.sort(key=lambda u: str(u.get("display_name", "")).lower())
    return users


@app.post("/api/users", dependencies=[Depends(supervisor_or_admin_dep)])
def create_user(req: UserUpsertRequest, request: Request):
    display_name = str(req.display_name).strip()
    role = str(req.role).strip().lower()
    card_id = str(req.card_id).strip()

    if not display_name:
        raise HTTPException(status_code=400, detail="Display name is required")
    if role not in {"supervisor", "operator"}:
        raise HTTPException(status_code=400, detail="Role must be supervisor or operator")
    if not card_id:
        raise HTTPException(status_code=400, detail="Card ID is required")

    users = _load_users()
    for user in users:
        if str(user.get("card_id", "")).strip() == card_id:
            raise HTTPException(status_code=409, detail="Card already assigned")

    new_user = {
        "id": _next_user_id(users),
        "display_name": display_name,
        "role": role,
        "card_id": card_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": _current_user_name(request),
    }
    users.append(new_user)
    _save_users(users)
    return _sanitize_user(new_user)


@app.delete("/api/users/{user_id}", dependencies=[Depends(supervisor_or_admin_dep)])
def delete_user(user_id: int, request: Request):
    current_session = get_session(request) or {}
    current_user_id = current_session.get("user_id")

    if current_user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own user")
    users = _load_users()
    filtered = [u for u in users if int(u.get("id", -1)) != user_id]
    if len(filtered) == len(users):
        raise HTTPException(status_code=404, detail="User not found")
    _save_users(filtered)
    return {"ok": True}


@app.get("/api/config", response_model=ConfigResponse, dependencies=[Depends(admin_dep)])
def get_config() -> ConfigResponse:
    cfg = load_config()
    return ConfigResponse(parts_root=cfg.parts_root)


@app.post("/api/config", response_model=ConfigResponse, dependencies=[Depends(admin_dep)])
def set_config(req: ConfigUpdateRequest) -> ConfigResponse:
    err = validate_parts_root(req.parts_root)
    if err is not None:
        raise HTTPException(status_code=400, detail=err)

    existing = load_config()
    new_cfg = AppConfig(
        parts_root=req.parts_root,
        admin_username=existing.admin_username,
        admin_password=existing.admin_password,
        secret_key=existing.secret_key,
        inactivity_timeout_minutes=existing.inactivity_timeout_minutes,
    )
    save_config(new_cfg)
    return ConfigResponse(parts_root=new_cfg.parts_root)


@app.get("/api/parts", dependencies=[Depends(any_user_dep)])
def get_parts():
    return scan_parts()


@app.get("/api/parts/{part_id}", dependencies=[Depends(any_user_dep)])
def part_detail(part_id: str):
    return get_part(part_id)

@app.post("/api/apply", dependencies=[Depends(any_user_dep)])
def apply(req: ApplyRequest):
    if not is_connected():
        raise HTTPException(status_code=500, detail="OPC UA not connected")

    write_zones(req.part_id, req.zones)
    zone_ids = [i for i in range(1, 41) if req.zones.get(i) or req.zones.get(str(i))]
    write_zone_list(zone_ids)
    write_recipe_name("")
    log_apply(req.part_id, req.zones)

    return {"status": "ok"}


@app.post("/api/opc/write-paths", dependencies=[Depends(any_user_dep)])
def write_paths_endpoint(req: WritePathsRequest):
    from app.opc_service import write_paths

    if not is_connected():
        raise HTTPException(status_code=500, detail="OPC UA not connected")

    write_paths(req.paths)
    write_recipe_name("")

    return {"status": "ok"}

@app.post("/api/opc/select-part", dependencies=[Depends(any_user_dep)])
def select_part_endpoint(req: SelectPartRequest):
    if not is_connected():
        raise HTTPException(status_code=500, detail="OPC UA not connected")

    selected_display_name = str(req.display_name or "").strip()
    if not selected_display_name:
        raise HTTPException(status_code=400, detail="display_name is required")

    write_part_name(selected_display_name)
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
    
def _last_state_file(part_id: str) -> Path:
    return LAST_STATE_ROOT / f"{part_id}.json"


def _load_last_state(part_id: str) -> Optional[dict[str, Any]]:
    path = _last_state_file(part_id)
    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _save_last_state(part_id: str, payload: dict[str, Any]) -> None:
    path = _last_state_file(part_id)
    path.write_text(json.dumps(payload, indent=2))


def _zone_ids_from_zone_map(zones: dict[str, Any] | dict[int, Any]) -> list[int]:
    zone_ids: list[int] = []

    if not isinstance(zones, dict):
        return zone_ids

    for i in range(1, 41):
        if zones.get(i) or zones.get(str(i)):
            zone_ids.append(i)

    return zone_ids


def _valid_zone_ids_for_orientation(part_id: str, orientation: Optional[int]) -> set[int]:
    if orientation not in (1, 2, 3, 4):
        return set()

    part = get_part(part_id)
    valid_ids: set[int] = set()

    for section in part.get("sections", []):
        for zone in section.get("zones", []):
            if (
                isinstance(zone, dict)
                and isinstance(zone.get("zone_id"), int)
                and zone.get("orientation") == orientation
            ):
                valid_ids.add(zone["zone_id"])

    return valid_ids

def _load_users() -> list[dict[str, Any]]:
    try:
        data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_users(users: list[dict[str, Any]]) -> None:
    USERS_FILE.write_text(json.dumps(users, indent=2), encoding="utf-8")


def _next_user_id(users: list[dict[str, Any]]) -> int:
    ids = [int(u.get("id", 0)) for u in users if isinstance(u, dict)]
    return max(ids, default=0) + 1


def _sanitize_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user.get("id"),
        "display_name": user.get("display_name", ""),
        "role": user.get("role", "operator"),
        "card_id": user.get("card_id", ""),
        "created_at": user.get("created_at"),
    }


def _find_user_by_card(card_id: str) -> Optional[dict[str, Any]]:
    normalized = str(card_id).strip()
    if not normalized:
        return None

    for user in _load_users():
        if str(user.get("card_id", "")).strip() == normalized:
            return user
    return None


def _current_user_name(request: Request) -> str:
    session = get_session(request) or {}
    return str(session.get("display_name") or "Unknown")


def _current_user_role(request: Request) -> str:
    session = get_session(request) or {}
    return str(session.get("role") or "operator")


def _now_shift_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _pulse_shift_completed_tag() -> None:
    if not is_connected():
        return

    try:
        write_shift_completed(1)
        time.sleep(10)
        if is_connected():
            write_shift_completed(0)
    except Exception as e:
        print("Failed pulsing Shift_Completed:", e)


# Helper to compare recipe IDs safely
def _recipe_id_matches(recipe: dict[str, Any], recipe_id: int) -> bool:
    try:
        return int(recipe.get("id", -1)) == recipe_id
    except Exception:
        return False



@app.get("/api/editor/parts/{part_id}/sections/{section_index}", dependencies=[Depends(supervisor_or_admin_dep)])
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
        "image_size": read_image_size(image_path),
        "zones": [],
    }

    if zones_path.exists():
        try:
            loaded = json.loads(zones_path.read_text(encoding="utf-8"))
            raw_zones = loaded.get("zones", [])
            zones_payload = {
                "image": loaded.get("image", image_path.name),
                "image_size": loaded.get("image_size", read_image_size(image_path)),
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
        "image_size": zones_payload.get("image_size", read_image_size(image_path)),
        "zones": zones_payload.get("zones", []),
        "part_used_zone_ids_other_sections": part_usage["used_ids"],
        "section_used_zone_ids": current_section_ids,
        "zone_ids_by_other_section": part_usage["by_section"],
    }


@app.post("/api/editor/parts/{part_id}/sections/{section_index}", dependencies=[Depends(supervisor_or_admin_dep)])
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
        "image_size": req.image_size or read_image_size(image_path),
        "zones": cleaned_zones,
    }

    zones_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    invalidate_scan_cache()

    return {"ok": True}


@app.post("/api/editor/parts/{part_id}/sections/{section_index}/import", dependencies=[Depends(supervisor_or_admin_dep)])
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


@app.get("/api/recipes/{part_id}", dependencies=[Depends(any_user_dep)])
def get_recipes(part_id: str):
    return _load_recipe_list(part_id)


@app.get("/api/parts/{part_id}/last-state", dependencies=[Depends(any_user_dep)])
def get_last_state(part_id: str):
    state = _load_last_state(part_id)
    return state or {
        "part_id": part_id,
        "orientation": None,
        "zones": {},
        "paths": [],
        "selected_recipe_id": None,
    }


@app.post("/api/parts/{part_id}/last-state", dependencies=[Depends(any_user_dep)])
def save_last_state(part_id: str, req: SaveLastStateRequest):
    incoming_saved_at = int(req.saved_at or 0)
    existing = _load_last_state(part_id) or {}
    existing_saved_at = int(existing.get("saved_at") or 0)

    if incoming_saved_at < existing_saved_at:
        return {"ok": True, "ignored": True}

    payload = {
        "part_id": part_id,
        "orientation": req.orientation if req.orientation in (1, 2, 3, 4) else None,
        "zones": req.zones if isinstance(req.zones, dict) else {},
        "paths": req.paths if isinstance(req.paths, list) else [],
        "selected_recipe_id": req.selected_recipe_id,
        "saved_at": incoming_saved_at,
    }
    _save_last_state(part_id, payload)
    return {"ok": True}

@app.post("/api/recipes/{part_id}/save", dependencies=[Depends(supervisor_or_admin_dep)])
def save_recipe(part_id: str, req: SaveRecipeRequest, request: Request):
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
        "created_by": _current_user_name(request),
        "created_by_role": _current_user_role(request),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    existing.append(new_recipe)
    _save_recipe_list(part_id, existing)

    return {"ok": True, "recipe": new_recipe}


@app.post("/api/recipes/{part_id}/load", dependencies=[Depends(any_user_dep)])
def load_recipe(part_id: str, req: LoadRecipeRequest):
    recipes = _load_recipe_list(part_id)

    recipe = next((r for r in recipes if _recipe_id_matches(r, req.recipe_id)), None)

    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    current_orientation = get_table_orientation()
    if current_orientation not in (1, 2, 3, 4):
        raise HTTPException(
            status_code=400,
            detail="Recipe cannot be loaded because the current table orientation is unavailable.",
        )

    valid_zone_ids = _valid_zone_ids_for_orientation(part_id, current_orientation)
    recipe_zone_ids = _zone_ids_from_zone_map(recipe.get("zones", {}))
    invalid_zone_ids = [zone_id for zone_id in recipe_zone_ids if zone_id not in valid_zone_ids]

    if invalid_zone_ids:
        raise HTTPException(
            status_code=400,
            detail=(
                "Recipe cannot be loaded because these saved zones are not available "
                f"for the current table orientation: {invalid_zone_ids}"
            ),
        )

    if not is_connected():
        raise HTTPException(status_code=409, detail="OPC not connected")

    write_paths(recipe.get("paths", []))
    write_zones(part_id, recipe.get("zones", {}))
    zone_ids = _zone_ids_from_zone_map(recipe.get("zones", {}))
    write_zone_list(zone_ids)
    write_recipe_name(str(recipe.get("name") or ""))

    return recipe

@app.put("/api/admin/recipes/{part_id}/{recipe_id}", dependencies=[Depends(supervisor_or_admin_dep)])
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


@app.delete("/api/admin/recipes/{part_id}/{recipe_id}", dependencies=[Depends(supervisor_or_admin_dep)])
def delete_recipe(part_id: str, recipe_id: int):
    recipes = _load_recipe_list(part_id)
    filtered = [r for r in recipes if not _recipe_id_matches(r, recipe_id)]

    if len(filtered) == len(recipes):
        raise HTTPException(status_code=404, detail="Recipe not found")

    _save_recipe_list(part_id, filtered)
    return {"ok": True}


@app.get("/api/opc/force", dependencies=[Depends(any_user_dep)])
def opc_force():
    from app.opc_service import get_force_reading

    value = get_force_reading()

    return {"value": value}


@app.get("/api/opc/paths", dependencies=[Depends(any_user_dep)])
def opc_paths():
    return {"paths": get_paths()}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/opc/status", dependencies=[Depends(any_user_dep)])
def opc_status():
    return {"connected": is_connected()}


@app.get("/api/opc/orientation", dependencies=[Depends(any_user_dep)])
def opc_orientation():
    return {
        "orientation": get_table_orientation(),
        "degrees": get_table_orientation_degrees(),
    }


@app.get("/api/opc/program-status", dependencies=[Depends(any_user_dep)])
def opc_program_status():
    return {"connected": is_connected(), **get_program_tags()}


@app.get("/parts/{file_path:path}")
def serve_part_file(file_path: str):
    cfg = load_config()
    parts_root = Path(cfg.parts_root).resolve()
    requested = (parts_root / file_path).resolve()

    if parts_root not in requested.parents and requested != parts_root:
        raise HTTPException(status_code=403, detail="Access denied")

    if not requested.exists() or not requested.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(requested)


# Serve React production build (catch-all)
@app.get("/{full_path:path}")
def serve_react_app(full_path: str):
    if not WEB_INDEX.exists():
        raise HTTPException(
            status_code=404,
            detail="React build not found. Run `npm run build` inside the web folder first.",
        )

    requested_path = (WEB_DIST / full_path).resolve()
    web_dist_root = WEB_DIST.resolve()

    if requested_path.exists() and requested_path.is_file() and web_dist_root in requested_path.parents:
        return FileResponse(requested_path)

    return FileResponse(WEB_INDEX)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_config=None,
        access_log=False,
    )