"""
Groot – LLM Training Studio
FastAPI Backend + StaticFiles serving for React frontend
"""
import sys
from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Add backend dir to path
sys.path.insert(0, str(Path(__file__).parent))

from database import init_db
from router.datasets import router as datasets_router
from router.jobs import router as jobs_router
from router.models import router as models_router
from router.hub import router as hub_router
from router.learnings import router as learnings_router
from router.whisper import router as whisper_router

# Init DB
init_db()

app = FastAPI(
    title="Groot – LLM Training Studio",
    description="Local LLM fine-tuning studio powered by MLX-LM",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers
app.include_router(datasets_router)
app.include_router(jobs_router)
app.include_router(models_router)
app.include_router(hub_router)
app.include_router(learnings_router)
app.include_router(whisper_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "groot", "version": "1.0.0"}


# Serve React frontend
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
FRONTEND_PUBLIC = Path(__file__).parent.parent / "frontend" / "public"

if FRONTEND_DIST.exists():
    # Serve static assets (compiled JS/CSS)
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    # Serve public directory (translations, icons, etc.)
    if FRONTEND_PUBLIC.exists():
        app.mount("/locales", StaticFiles(directory=str(FRONTEND_PUBLIC / "locales")), name="locales")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str, response: Response):
        # Don't intercept API routes
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(404, "API endpoint not found")
        index_file = FRONTEND_DIST / "index.html"
        if index_file.exists():
            # No-cache for HTML so browser always fetches fresh JS/CSS references
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
            return FileResponse(str(index_file))
        return {"error": "Frontend not built. Run: cd frontend && npm run build"}
else:
    @app.get("/")
    async def root():
        return {
            "message": "Groot Backend is running! Frontend not built yet.",
            "hint": "cd frontend && npm install && npm run build",
            "docs": "/docs"
        }
