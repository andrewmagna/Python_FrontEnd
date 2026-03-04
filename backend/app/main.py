from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routes.parts import router as parts_router

app = FastAPI(title="Parts/Zones Server")

# CORS for Vite dev (we can tighten later)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static mount: serve C:\assets as /assets
assets_root = Path(settings.assets_root)
app.mount("/assets", StaticFiles(directory=str(assets_root)), name="assets")

# API routes
app.include_router(parts_router)


@app.get("/api/health")
def health():
    return {"ok": True}