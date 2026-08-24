from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import shutil
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import cv2
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
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
from app.config_store import AppConfig, load_config, save_config, validate_parts_root, users_file_path
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
    write_part_id,
    write_recipe_name,
    write_zone_list,
    write_shift_start_time,
    write_shift_end_time,
    write_shift_completed,
    write_shift_started,
    get_program_tags,
)
from app.overlay_import import import_polygons_from_overlay
from app.part_ids import (
    MAX_PART_ID,
    MIN_PART_ID,
    assign_new_part_id,
    get_part_id,
    load_part_ids,
    remove_part_id,
    set_part_id,
)
from app.parts_service import get_part, scan_parts, invalidate_scan_cache, read_image_size


def _hash_password(password: str) -> tuple[str, str]:
    salt = os.urandom(32).hex()
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 260000)
    return h.hex(), salt


def _verify_password(password: str, stored_hash: str, salt: str) -> bool:
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 260000)
    return hmac.compare_digest(h.hex(), stored_hash)


def _ensure_secret_key() -> None:
    """Generate a strong random secret key if the default placeholder is in use."""
    cfg = load_config()
    if not cfg.secret_key or cfg.secret_key == "dev_secret_change_me":
        new_key = secrets.token_urlsafe(32)
        new_cfg = AppConfig(
            parts_root=cfg.parts_root,
            admin_username=cfg.admin_username,
            admin_password=cfg.admin_password,
            admin_password_hash=cfg.admin_password_hash,
            admin_password_salt=cfg.admin_password_salt,
            secret_key=new_key,
            inactivity_timeout_minutes=cfg.inactivity_timeout_minutes,
            bind_host=cfg.bind_host,
            bind_port=cfg.bind_port,
        )
        save_config(new_cfg)
        print("Generated new random secret_key in config.json")


def _migrate_bind_host() -> None:
    # "127.0.0.1" is the stale auto-written default from the previous build; rewrite it
    # to "0.0.0.0" so existing machines get network access without manual editing.
    # Deliberate opt-out: set bind_host to "localhost" — uvicorn treats it as loopback-only
    # and this function leaves any value other than the exact string "127.0.0.1" untouched.
    cfg = load_config()
    if cfg.bind_host == "127.0.0.1":
        new_cfg = AppConfig(
            parts_root=cfg.parts_root,
            admin_username=cfg.admin_username,
            admin_password=cfg.admin_password,
            admin_password_hash=cfg.admin_password_hash,
            admin_password_salt=cfg.admin_password_salt,
            secret_key=cfg.secret_key,
            inactivity_timeout_minutes=cfg.inactivity_timeout_minutes,
            bind_host="0.0.0.0",
            bind_port=cfg.bind_port,
        )
        save_config(new_cfg)
        print('Migrated bind_host 127.0.0.1 -> 0.0.0.0 (set bind_host to "localhost" in config.json to keep the app local-only)')


def _migrate_admin_password() -> None:
    """Migrate plaintext admin_password to PBKDF2 hash on first run."""
    cfg = load_config()
    if cfg.admin_password and not cfg.admin_password_hash:
        password_hash, salt = _hash_password(cfg.admin_password)
        new_cfg = AppConfig(
            parts_root=cfg.parts_root,
            admin_username=cfg.admin_username,
            admin_password="",
            admin_password_hash=password_hash,
            admin_password_salt=salt,
            secret_key=cfg.secret_key,
            inactivity_timeout_minutes=cfg.inactivity_timeout_minutes,
            bind_host=cfg.bind_host,
            bind_port=cfg.bind_port,
        )
        save_config(new_cfg)
        print("Migrated admin password to hashed storage")


@asynccontextmanager
async def lifespan(_: FastAPI):
    _ensure_secret_key()
    _migrate_admin_password()
    _migrate_bind_host()
    connect()
    start_reconnect_loop()
    init_db()
    _load_persisted_active_part()
    yield


app = FastAPI(title="ZoneSelect", lifespan=lifespan)

_active_part_id: Optional[str] = None
_active_part_display_name: Optional[str] = None

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

ACTIVE_PART_FILE = LAST_STATE_ROOT / "_active_part.json"

USERS_ROOT = _DATA_ROOT / "data" / "users"
USERS_ROOT.mkdir(parents=True, exist_ok=True)
USERS_FILE = users_file_path()

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
    sections: list = []


class WritePathsRequest(BaseModel):
    paths: list


class SelectPartRequest(BaseModel):
    part_id: str
    display_name: str


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class EditorSaveRequest(BaseModel):
    image: str
    image_size: dict
    zones: list
    sections: list = []


class SaveRecipeRequest(BaseModel):
    name: str
    description: Optional[str] = None
    paths: list
    zones: dict
    sections: list = []


class LoadRecipeRequest(BaseModel):
    recipe_id: int

class UpdateRecipeRequest(BaseModel):
    name: str
    description: Optional[str] = None
    paths: list
    zones: dict
    sections: list = []

class SaveLastStateRequest(BaseModel):
    orientation: Optional[int] = None
    zones: dict
    paths: list
    selected_recipe_id: Optional[int] = None
    saved_at: Optional[int] = None
    sections: list = []
    section_sources: dict = {}
    
class RFIDLoginRequest(BaseModel):
    card_id: str


class UserUpsertRequest(BaseModel):
    display_name: str
    role: str
    card_id: str


class UpdatePartNumericIdRequest(BaseModel):
    numeric_id: int



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

    if req.username != expected_username:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if cfg.admin_password_hash and cfg.admin_password_salt:
        if not _verify_password(req.password, cfg.admin_password_hash, cfg.admin_password_salt):
            raise HTTPException(status_code=401, detail="Invalid credentials")
    else:
        # Fallback for first-run before migration completes; reject blank stored password
        expected_password = getattr(cfg, "admin_password", "")
        if not expected_password or req.password != expected_password:
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

    if is_connected():
        try:
            write_shift_started(1)
        except Exception as e:
            print("Failed writing Shift_Started on admin login:", e)

    return {"ok": True}

@app.post("/api/logout")
def logout(response: Response):
    if is_connected():
        try:
            write_shift_end_time(_now_shift_timestamp())
        except Exception as e:
            print("Failed writing Shift_End_Time on logout:", e)

        try:
            write_shift_started(0)
        except Exception as e:
            print("Failed writing Shift_Started on logout:", e)

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

    if is_connected():
        try:
            write_shift_started(1)
        except Exception as e:
            print("Failed writing Shift_Started on RFID login:", e)

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
        admin_password_hash=existing.admin_password_hash,
        admin_password_salt=existing.admin_password_salt,
        secret_key=existing.secret_key,
        inactivity_timeout_minutes=existing.inactivity_timeout_minutes,
        bind_host=existing.bind_host,
        bind_port=existing.bind_port,
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

    part = get_part(req.part_id)

    # Normalize active section slots (1..5)
    active_slots = {s for s in req.sections if isinstance(s, int) and 1 <= s <= 5}

    # Build a lookup of part sections by slot
    part_sections = {s["slot"]: s for s in part.get("sections", [])}

    # D8: validate each requested active slot exists on part and matches table orientation
    if active_slots:
        current_orientation = get_table_orientation()
        if current_orientation not in (1, 2, 3, 4):
            raise HTTPException(
                status_code=400,
                detail="Sections cannot be applied because the table orientation is unavailable",
            )
        for slot in sorted(active_slots):
            if slot not in part_sections:
                raise HTTPException(
                    status_code=400,
                    detail=f"Section slot {slot} is not defined for part '{req.part_id}'",
                )
            section = part_sections[slot]
            if section["orientation"] != current_orientation:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Section slot {slot} requires orientation {section['orientation']} "
                        f"but table is at orientation {current_orientation}"
                    ),
                )

    full_map = _compose_full_zone_map(req.zones, active_slots, part_sections)

    write_zones(req.part_id, full_map)
    write_part_id(get_part_id(req.part_id))
    zone_ids = [i for i in range(1, 41) if full_map.get(i) or full_map.get(str(i))]
    write_zone_list(zone_ids)
    write_recipe_name("")
    log_apply(req.part_id, full_map)

    return {"status": "ok"}


@app.post("/api/opc/write-paths", dependencies=[Depends(any_user_dep)])
def write_paths_endpoint(req: WritePathsRequest):
    from app.opc_service import write_paths

    if not is_connected():
        raise HTTPException(status_code=500, detail="OPC UA not connected")

    write_paths(req.paths)
    write_recipe_name("")

    return {"status": "ok"}

def _load_persisted_active_part() -> None:
    global _active_part_id, _active_part_display_name
    try:
        data = json.loads(ACTIVE_PART_FILE.read_text(encoding="utf-8"))
        _active_part_id = data.get("part_id") or None
        _active_part_display_name = data.get("display_name") or None
    except Exception:
        pass


def _persist_active_part() -> None:
    try:
        ACTIVE_PART_FILE.write_text(
            json.dumps({"part_id": _active_part_id, "display_name": _active_part_display_name}, indent=2),
            encoding="utf-8",
        )
    except Exception as e:
        print(f"Failed persisting active part: {e}")


@app.get("/api/active-part", dependencies=[Depends(any_user_dep)])
def get_active_part():
    return {"part_id": _active_part_id, "display_name": _active_part_display_name}


@app.post("/api/active-part", dependencies=[Depends(any_user_dep)])
def set_active_part(req: SelectPartRequest):
    global _active_part_id, _active_part_display_name
    _active_part_id = req.part_id
    _active_part_display_name = req.display_name
    _persist_active_part()
    return {"part_id": _active_part_id, "display_name": _active_part_display_name}


@app.post("/api/opc/select-part", dependencies=[Depends(any_user_dep)])
def select_part_endpoint(req: SelectPartRequest):
    if not is_connected():
        raise HTTPException(status_code=500, detail="OPC UA not connected")

    selected_display_name = str(req.display_name or "").strip()
    if not selected_display_name:
        raise HTTPException(status_code=400, detail="display_name is required")

    write_part_name(selected_display_name)
    write_part_id(get_part_id(req.part_id))
    return {"status": "ok"}


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


def _compose_full_zone_map(
    zones: dict,
    active_slots: set,
    part_sections: dict,
) -> dict:
    """Build the full zone bit-map including section slot bits."""
    full_map: dict = dict(zones)
    for slot in range(1, 6):
        slot_id = 35 + slot  # slot 1 -> Zone_36, ..., slot 5 -> Zone_40
        section = part_sections.get(slot)
        if section and slot in active_slots:
            for zid in section["zone_ids"]:
                full_map[str(zid)] = False
                full_map[zid] = False
            full_map[str(slot_id)] = True
            full_map[slot_id] = True
        else:
            full_map[str(slot_id)] = False
            full_map[slot_id] = False
    return full_map


def _valid_zone_ids_for_orientation(part_id: str, orientation: Optional[int]) -> set[int]:
    if orientation not in (1, 2, 3, 4):
        return set()

    part = get_part(part_id)
    valid_ids: set[int] = set()

    for zone in part.get("zones", []):
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



@app.get("/api/editor/parts/{part_id}", dependencies=[Depends(supervisor_or_admin_dep)])
def editor_get_part(part_id: str):
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    if not part_dir.exists():
        raise HTTPException(status_code=404, detail="Part not found")

    image_path = part_dir / "part.png"
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="part.png not found")

    zones_path = part_dir / "zones.json"
    zones: list[dict[str, Any]] = []
    sections: list[dict[str, Any]] = []
    image_size = read_image_size(image_path)

    if zones_path.exists():
        try:
            loaded = json.loads(zones_path.read_text(encoding="utf-8"))
            raw_zones = loaded.get("zones", [])
            zones = [
                _normalize_zone_for_response(z)
                for z in raw_zones
                if isinstance(z, dict)
            ]
            image_size = loaded.get("image_size", image_size)
            # Load sections
            for s in loaded.get("sections", []):
                if not isinstance(s, dict):
                    continue
                slot = s.get("slot")
                if not isinstance(slot, int) or slot < 1 or slot > 5:
                    continue
                zone_ids = s.get("zone_ids", [])
                valid_ids = sorted({z for z in zone_ids if isinstance(z, int) and 1 <= z <= 35})
                if len(valid_ids) < 2:
                    continue
                orientation = s.get("orientation")
                if orientation not in (1, 2, 3, 4):
                    continue
                sections.append({
                    "slot": slot,
                    "name": str(s.get("name") or ""),
                    "zone_ids": valid_ids,
                    "orientation": orientation,
                })
            sections.sort(key=lambda x: x["slot"])
        except Exception:
            pass

    used_zone_ids = sorted(
        z.get("zone_id") for z in zones if isinstance(z.get("zone_id"), int)
    )

    mtime = int(image_path.stat().st_mtime)

    return {
        "part_id": part_id,
        "image_url": f"/parts/{part_id}/part.png?v={mtime}",
        "image_size": image_size,
        "zones": zones,
        "sections": sections,
        "used_zone_ids": used_zone_ids,
    }


@app.post("/api/editor/parts/{part_id}", dependencies=[Depends(supervisor_or_admin_dep)])
def editor_save_part(part_id: str, req: EditorSaveRequest):
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    if not part_dir.exists():
        raise HTTPException(status_code=404, detail="Part not found")

    image_path = part_dir / "part.png"
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="part.png not found")

    zones_path = part_dir / "zones.json"

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

        if zone_id < 1 or zone_id > 35:
            raise HTTPException(
                status_code=400,
                detail=f"Zone ID {zone_id} is out of range (1..35). IDs 36..40 are reserved for zone sections.",
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
        raise HTTPException(status_code=400, detail="Duplicate zone IDs within zones.json")

    # Validate and clean sections
    cleaned_sections: list[dict[str, Any]] = []
    seen_section_slots: set[int] = set()
    zone_id_set = set(current_ids)

    for s in req.sections:
        if not isinstance(s, dict):
            raise HTTPException(status_code=400, detail="Each section must be an object")
        slot = s.get("slot")
        if not isinstance(slot, int) or slot < 1 or slot > 5:
            raise HTTPException(status_code=400, detail="Section slot must be 1..5")
        if slot in seen_section_slots:
            raise HTTPException(status_code=400, detail=f"Duplicate section slot {slot}")
        seen_section_slots.add(slot)

        name = str(s.get("name") or "")
        raw_ids = s.get("zone_ids", [])
        valid_ids = sorted({z for z in raw_ids if isinstance(z, int) and 1 <= z <= 35})
        if len(valid_ids) < 2:
            raise HTTPException(
                status_code=400,
                detail=f"Section slot {slot} must have at least 2 zone IDs in range 1..35",
            )

        orientation = s.get("orientation")
        if orientation not in (1, 2, 3, 4):
            raise HTTPException(
                status_code=400,
                detail=f"Section slot {slot} has invalid orientation",
            )

        # All member zones must exist and share the same orientation
        for zid in valid_ids:
            if zid not in zone_id_set:
                raise HTTPException(
                    status_code=400,
                    detail=f"Section slot {slot} references zone {zid} which doesn't exist in zones",
                )
            zone_obj = next((z for z in cleaned_zones if z["zone_id"] == zid), None)
            if zone_obj and zone_obj.get("orientation") != orientation:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Section slot {slot} orientation {orientation} doesn't match "
                        f"zone {zid} orientation {zone_obj.get('orientation')}"
                    ),
                )

        cleaned_sections.append({
            "slot": slot,
            "name": name,
            "zone_ids": valid_ids,
            "orientation": orientation,
        })

    cleaned_sections.sort(key=lambda x: x["slot"])

    payload = {
        "image": "part.png",
        "image_size": req.image_size or read_image_size(image_path),
        "zones": cleaned_zones,
        "sections": cleaned_sections,
    }

    zones_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    invalidate_scan_cache()

    return {"ok": True}


@app.post("/api/editor/parts/{part_id}/import", dependencies=[Depends(supervisor_or_admin_dep)])
def editor_import_overlay(part_id: str):
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    if not part_dir.exists():
        raise HTTPException(status_code=404, detail="Part not found")

    overlay_path = part_dir / "overlay.png"
    clean_path = part_dir / "part.png"

    if not clean_path.exists():
        raise HTTPException(status_code=404, detail="part.png not found")

    try:
        result = import_polygons_from_overlay(overlay_path, clean_path=clean_path)

        clean_img = cv2.imread(str(clean_path), cv2.IMREAD_COLOR)
        if clean_img is None:
            raise HTTPException(status_code=500, detail="Failed to load part image")

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
        "sections": [],
        "section_sources": {},
    }


@app.post("/api/parts/{part_id}/last-state", dependencies=[Depends(any_user_dep)])
def save_last_state(part_id: str, req: SaveLastStateRequest):
    incoming_saved_at = int(req.saved_at or 0)
    existing = _load_last_state(part_id) or {}
    existing_saved_at = int(existing.get("saved_at") or 0)

    if incoming_saved_at < existing_saved_at:
        return {"ok": True, "ignored": True}

    valid_sources = {"manual", "auto"}
    section_sources = {
        str(k): v
        for k, v in req.section_sources.items()
        if str(k) in {"1", "2", "3", "4", "5"} and v in valid_sources
    }
    payload = {
        "part_id": part_id,
        "orientation": req.orientation if req.orientation in (1, 2, 3, 4) else None,
        "zones": req.zones if isinstance(req.zones, dict) else {},
        "paths": req.paths if isinstance(req.paths, list) else [],
        "selected_recipe_id": req.selected_recipe_id,
        "sections": [s for s in req.sections if isinstance(s, int) and 1 <= s <= 5],
        "section_sources": section_sources,
        "saved_at": incoming_saved_at,
    }
    _save_last_state(part_id, payload)
    return {"ok": True}

def _validate_recipe_zones(part_id: str, zones: dict) -> None:
    """Raise HTTP 400 if zones contains IDs not present in the part's zones.json or uses reserved IDs 36..40."""
    # Reject section slot IDs (36..40) in recipe zone maps
    for i in range(36, 41):
        if zones.get(i) or zones.get(str(i)):
            raise HTTPException(
                status_code=400,
                detail=f"Zone ID {i} is reserved for section slots and cannot be stored in recipe zones",
            )

    part = get_part(part_id)
    valid_ids = {z["zone_id"] for z in part.get("zones", []) if isinstance(z.get("zone_id"), int) and 1 <= z["zone_id"] <= 35}
    recipe_zone_ids = [i for i in range(1, 36) if zones.get(i) or zones.get(str(i))]
    invalid = sorted(z for z in recipe_zone_ids if z not in valid_ids)
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Zone IDs not valid for part '{part_id}': {invalid}",
        )


def _validate_recipe_sections(part_id: str, sections: list) -> None:
    """Raise HTTP 400 if recipe sections reference slots not defined for the part."""
    if not sections:
        return
    part = get_part(part_id)
    part_section_slots = {s["slot"] for s in part.get("sections", [])}
    for slot in sections:
        if not isinstance(slot, int) or slot < 1 or slot > 5:
            raise HTTPException(status_code=400, detail=f"Invalid section slot: {slot}")
        if slot not in part_section_slots:
            raise HTTPException(
                status_code=400,
                detail=f"Section slot {slot} is not defined for part '{part_id}'",
            )


@app.post("/api/recipes/{part_id}/save", dependencies=[Depends(supervisor_or_admin_dep)])
def save_recipe(part_id: str, req: SaveRecipeRequest, request: Request):
    _validate_recipe_zones(part_id, req.zones)
    _validate_recipe_sections(part_id, req.sections)
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
        "sections": [s for s in req.sections if isinstance(s, int) and 1 <= s <= 5],
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

    # D9: handle recipe sections — validate and build full zone map with slot bits
    recipe_section_slots = {s for s in recipe.get("sections", []) if isinstance(s, int) and 1 <= s <= 5}
    part = get_part(part_id)
    part_sections = {s["slot"]: s for s in part.get("sections", [])}

    for slot in recipe_section_slots:
        if slot not in part_sections:
            raise HTTPException(
                status_code=400,
                detail=f"Recipe references section slot {slot} which is not defined for part '{part_id}'",
            )
        section = part_sections[slot]
        if section["orientation"] != current_orientation:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Recipe section slot {slot} requires orientation {section['orientation']} "
                    f"but table is at orientation {current_orientation}"
                ),
            )

    full_map = _compose_full_zone_map(recipe.get("zones", {}), recipe_section_slots, part_sections)

    write_paths(recipe.get("paths", []))
    write_zones(part_id, full_map)
    write_part_id(get_part_id(part_id))
    zone_ids = [i for i in range(1, 41) if full_map.get(i) or full_map.get(str(i))]
    write_zone_list(zone_ids)
    write_recipe_name(str(recipe.get("name") or ""))

    return recipe

@app.put("/api/admin/recipes/{part_id}/{recipe_id}", dependencies=[Depends(supervisor_or_admin_dep)])
def update_recipe(part_id: str, recipe_id: int, req: UpdateRecipeRequest):
    _validate_recipe_zones(part_id, req.zones)
    _validate_recipe_sections(part_id, req.sections)
    recipes = _load_recipe_list(part_id)

    updated_recipe = None
    for recipe in recipes:
        if _recipe_id_matches(recipe, recipe_id):
            recipe["name"] = req.name
            recipe["description"] = req.description
            recipe["paths"] = req.paths
            recipe["zones"] = req.zones
            recipe["sections"] = [s for s in req.sections if isinstance(s, int) and 1 <= s <= 5]
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


_VALID_IMAGE_EXTS = {".png", ".jpg", ".jpeg"}
_INVALID_FOLDER_CHARS = set('<>:"/\\|?*')


def _require_safe_part_folder(part_id: str) -> None:
    if not part_id or part_id in {".", ".."} or "/" in part_id or "\\" in part_id:
        raise HTTPException(status_code=400, detail="Invalid part name")


def _validate_new_part_folder_name(name: str) -> str:
    folder = str(name or "").strip().replace(" ", "_")
    if not folder:
        raise HTTPException(status_code=400, detail="Part name is required")
    for ch in folder:
        if ch in _INVALID_FOLDER_CHARS or ord(ch) < 32:
            raise HTTPException(
                status_code=400,
                detail=f"Part name contains a character not allowed in folder names: {ch!r}",
            )
    if folder in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid part name")
    return folder


def _save_upload_as_png(upload: UploadFile, dest: Path, label: str) -> None:
    ext = Path(upload.filename or "").suffix.lower()
    if ext not in _VALID_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"{label} must be a .png, .jpg or .jpeg file")

    data = upload.file.read()
    if not data:
        raise HTTPException(status_code=400, detail=f"{label} file is empty")

    if ext == ".png":
        dest.write_bytes(data)
        return

    tmp = dest.parent / f"_upload_tmp{ext}"
    tmp.write_bytes(data)
    try:
        img = cv2.imread(str(tmp), cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail=f"{label} could not be decoded as an image")
        if not cv2.imwrite(str(dest), img):
            raise HTTPException(status_code=500, detail=f"Failed converting {label.lower()} to PNG")
    finally:
        try:
            tmp.unlink()
        except Exception:
            pass


@app.get("/api/admin/parts", dependencies=[Depends(supervisor_or_admin_dep)])
def admin_list_parts():
    return [
        {
            "part_id": p["part_id"],
            "display_name": p["display_name"],
            "numeric_id": p.get("numeric_id", 0),
            "image_url": p["image_url"],
        }
        for p in scan_parts()
    ]


@app.put("/api/admin/parts/{part_id}/id", dependencies=[Depends(supervisor_or_admin_dep)])
def admin_update_part_numeric_id(part_id: str, req: UpdatePartNumericIdRequest):
    _require_safe_part_folder(part_id)

    cfg = load_config()
    part_dir = Path(cfg.parts_root) / part_id
    if not part_dir.is_dir():
        raise HTTPException(status_code=404, detail="Part not found")

    new_id = int(req.numeric_id)
    if new_id < MIN_PART_ID or new_id > MAX_PART_ID:
        raise HTTPException(
            status_code=400,
            detail=f"Part ID must be an integer between {MIN_PART_ID} and {MAX_PART_ID}",
        )

    mapping = load_part_ids()
    for other, other_id in mapping.items():
        if other != part_id and other_id == new_id:
            raise HTTPException(
                status_code=400,
                detail=f"Part ID {new_id} is already used by '{other.replace('_', ' ')}'",
            )

    set_part_id(part_id, new_id)
    invalidate_scan_cache()

    if part_id == _active_part_id and is_connected():
        try:
            write_part_id(new_id)
        except Exception as e:
            print("Failed writing Part_ID after id change:", e)

    return {"part_id": part_id, "numeric_id": new_id}


@app.post("/api/admin/parts", dependencies=[Depends(supervisor_or_admin_dep)])
def admin_add_part(
    name: str = Form(...),
    image: UploadFile = File(...),
    overlay: Optional[UploadFile] = File(None),
):
    folder = _validate_new_part_folder_name(name)

    cfg = load_config()
    root = Path(cfg.parts_root)
    if not root.is_dir():
        raise HTTPException(status_code=500, detail="Parts root folder is not available")

    part_dir = root / folder
    if part_dir.exists():
        raise HTTPException(status_code=400, detail=f"A part folder named '{folder}' already exists")

    part_dir.mkdir(parents=True)
    try:
        _save_upload_as_png(image, part_dir / "part.png", "Image")
        if overlay is not None and str(overlay.filename or "").strip():
            _save_upload_as_png(overlay, part_dir / "overlay.png", "Overlay")
    except HTTPException:
        shutil.rmtree(part_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(part_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed saving part files: {e}")

    numeric_id = assign_new_part_id(folder)
    invalidate_scan_cache()

    return {
        "part_id": folder,
        "display_name": folder.replace("_", " "),
        "numeric_id": numeric_id,
        "image_url": f"/parts/{folder}/part.png",
    }


@app.delete("/api/admin/parts/{part_id}", dependencies=[Depends(supervisor_or_admin_dep)])
def admin_remove_part(part_id: str):
    global _active_part_id, _active_part_display_name

    _require_safe_part_folder(part_id)

    cfg = load_config()
    part_dir = Path(cfg.parts_root) / part_id
    if not part_dir.is_dir():
        raise HTTPException(status_code=404, detail="Part not found")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    removed_dir = _DATA_ROOT / "data" / "_removed" / f"{part_id}_{timestamp}"
    removed_dir.mkdir(parents=True, exist_ok=True)

    try:
        # shutil.move handles parts_root living on another volume
        shutil.move(str(part_dir), str(removed_dir / part_id))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed archiving part folder: {e}")

    # Recipes and last-state share the file name <part>.json, so archive each
    # under its own subfolder.
    for label, src in (("recipes", _recipe_file(part_id)), ("last_state", _last_state_file(part_id))):
        if src.exists():
            try:
                dest_dir = removed_dir / label
                dest_dir.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(dest_dir / src.name))
            except Exception as e:
                print(f"Failed archiving {label} for {part_id}: {e}")

    remove_part_id(part_id)

    if _active_part_id == part_id:
        _active_part_id = None
        _active_part_display_name = None
        _persist_active_part()

    invalidate_scan_cache()
    return {"ok": True}


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

    cfg = load_config()
    host = cfg.bind_host
    port = cfg.bind_port
    suffix = " (accessible from the network)" if host not in ("127.0.0.1", "localhost") else ""
    print(f"ZoneSelect listening on http://{host}:{port}{suffix}")
    uvicorn.run(app, host=host, port=port, log_config=None, access_log=False)