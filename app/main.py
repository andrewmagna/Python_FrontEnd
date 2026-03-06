from __future__ import annotations

from fastapi import FastAPI, Request, Response, Depends, HTTPException
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from app.config_store import load_config
from app.parts_service import scan_parts
from app.parts_service import get_part
from app.opc_service import connect, write_zones, is_connected
from contextlib import asynccontextmanager
from app.admin_auth import set_admin_cookie, clear_admin_cookie, is_admin, admin_dep
from app.overlay_import import import_polygons_from_overlay


from app.config_store import load_config, save_config, validate_parts_root, AppConfig
from pydantic import BaseModel
from app.audit import init_db, log_apply

import json


@asynccontextmanager
async def lifespan(app):
    connect()
    init_db()
    yield
    
app = FastAPI(title="ZoneSelect", lifespan=lifespan)
cfg = load_config()
parts_root = Path(cfg.parts_root)

if parts_root.exists():
    app.mount("/parts", StaticFiles(directory=parts_root), name="parts")


class ConfigResponse(BaseModel):
    parts_root: str


class ConfigUpdateRequest(BaseModel):
    parts_root: str
    
class ApplyRequest(BaseModel):
    part_id: str
    zones: dict
    
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


@app.get("/api/admin/status")
def admin_status(request: Request):
    return {"admin": is_admin(request)}


@app.post("/api/admin/login")
def admin_login(req: AdminLoginRequest, response: Response):
    cfg = load_config()
    expected = getattr(cfg, "admin_password", "change_me")

    if req.password != expected:
        from fastapi import HTTPException
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
        # FastAPI will convert this to a 422 style response if we raise a value error
        # but we want a clean 400 with a readable message
        from fastapi import HTTPException
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
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="OPC UA not connected")

    write_zones(req.part_id, req.zones)
    log_apply(req.part_id, req.zones)

    return {"status":"ok"}

@app.get("/api/editor/parts/{part_id}/sections/{section_index}", dependencies=[Depends(admin_dep)])
def editor_get_section(part_id: str, section_index: int):
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    image_path = part_dir / "sections" / f"section{section_index}_clean.png"
    zones_path = part_dir / "zones" / f"section{section_index}.json"

    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Section image not found")

    zones_payload = {
        "image": image_path.name,
        "image_size": {"width": 1920, "height": 1080},
        "zones": [],
    }

    if zones_path.exists():
        try:
            zones_payload = json.loads(zones_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    return {
        "part_id": part_id,
        "section_index": section_index,
        "image_url": f"/parts/{part_id}/sections/section{section_index}_clean.png",
        "image_size": zones_payload.get("image_size", {"width": 1920, "height": 1080}),
        "zones": zones_payload.get("zones", []),
    }


@app.post("/api/editor/parts/{part_id}/sections/{section_index}", dependencies=[Depends(admin_dep)])
def editor_save_section(part_id: str, section_index: int, req: EditorSaveRequest):
    cfg = load_config()
    root = Path(cfg.parts_root)

    part_dir = root / part_id
    zones_dir = part_dir / "zones"
    zones_dir.mkdir(parents=True, exist_ok=True)

    zones_path = zones_dir / f"section{section_index}.json"

    payload = {
        "image": req.image,
        "image_size": req.image_size,
        "zones": req.zones,
    }

    zones_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    return {"ok": True}

@app.post("/api/editor/parts/{part_id}/sections/{section_index}/import", dependencies=[Depends(admin_dep)])
def editor_import_overlay(part_id: str, section_index: int):
    cfg = load_config()
    root = Path(cfg.parts_root)

    overlay_path = root / part_id / "sections" / f"section{section_index}_overlay.png"

    try:
        result = import_polygons_from_overlay(overlay_path)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")


@app.get("/health")
def health():
    return {"ok": True}

@app.get("/api/opc/status")
def opc_status():
    return {"connected": is_connected()}