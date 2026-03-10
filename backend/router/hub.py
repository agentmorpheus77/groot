"""
Groot – Model Hub Router
Fetches models from HuggingFace (mlx-community + lmstudio-community),
tracks downloads, and lists cached models.
"""
import asyncio
import json
import os
import re
import time
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/hub", tags=["hub"])

# ── In-memory caches ─────────────────────────────────────────────────────────
_models_cache: dict = {}       # {"data": [...], "ts": float}
_download_status: dict = {}    # {model_id: {status, progress, size_downloaded, speed, pid}}

HF_CACHE_DIR = Path.home() / ".cache" / "huggingface" / "hub"
CACHE_TTL = 3600  # 1 hour


# ── Helpers ───────────────────────────────────────────────────────────────────

def _detect_family(model_id: str, tags: list[str]) -> str:
    name_lower = model_id.lower()
    for family in ["qwen3", "qwen2.5", "qwen2", "qwen", "llama", "mistral", "gemma",
                   "phi", "deepseek", "falcon", "bloom", "gpt2", "opt"]:
        if family.replace(".", "").replace("2", "") in name_lower.replace(".", ""):
            # More specific matching
            pass
    # Ordered from most-specific to least
    checks = [
        ("qwen3",     "Qwen3"),
        ("qwen2.5",   "Qwen2.5"),
        ("qwen2",     "Qwen2"),
        ("qwen",      "Qwen"),
        ("deepseek",  "DeepSeek"),
        ("llama-3",   "Llama 3"),
        ("llama",     "Llama"),
        ("mistral",   "Mistral"),
        ("gemma-3",   "Gemma 3"),
        ("gemma",     "Gemma"),
        ("phi-4",     "Phi-4"),
        ("phi-3",     "Phi-3"),
        ("phi",       "Phi"),
        ("falcon",    "Falcon"),
        ("bloom",     "BLOOM"),
        ("gpt2",      "GPT-2"),
        ("opt",       "OPT"),
    ]
    for key, label in checks:
        if key in name_lower:
            return label
    return "Other"


def _estimate_size(model_id: str, tags: list[str]) -> str:
    name_lower = model_id.lower()
    # Param size patterns: 0.5b, 1b, 1.5b, 1.7b, 3b, 4b, 7b, 8b, 14b, 32b, 70b
    size_map = [
        (r"70b",  "~40 GB"),
        (r"32b",  "~20 GB"),
        (r"14b",  "~9 GB"),
        (r"8b",   "~5 GB"),
        (r"7b",   "~4.5 GB"),
        (r"4b",   "~2.5 GB"),
        (r"3b",   "~2 GB"),
        (r"1\.7b", "~1.1 GB"),
        (r"1\.5b", "~1 GB"),
        (r"1b",   "~0.8 GB"),
        (r"0\.5b", "~0.4 GB"),
    ]
    for pattern, label in size_map:
        if re.search(pattern, name_lower):
            return label
    return "~? GB"


def _parse_languages(tags: list[str]) -> list[str]:
    lang_codes = set()
    iso_2 = re.compile(r"^[a-z]{2}$")
    iso_3 = re.compile(r"^[a-z]{3}$")
    for tag in tags:
        tag_low = tag.lower()
        if tag_low.startswith("language:"):
            lang_codes.add(tag_low.split(":", 1)[1][:2])
        elif iso_2.match(tag_low) and tag_low not in {"en", "de"}:  # will add en/de below if present
            lang_codes.add(tag_low)
        elif iso_2.match(tag_low):
            lang_codes.add(tag_low)
    return sorted(lang_codes) or ["en"]


def _is_cached(model_id: str) -> bool:
    """Check if model is locally cached in HF hub cache."""
    cache_name = "models--" + model_id.replace("/", "--")
    cache_path = HF_CACHE_DIR / cache_name
    if cache_path.exists():
        # Check it has actual content (not just empty dir)
        snapshots = cache_path / "snapshots"
        if snapshots.exists():
            for snap in snapshots.iterdir():
                if snap.is_dir():
                    return True
    return False


def _parse_model(raw: dict) -> dict:
    model_id = raw.get("id", "")
    tags = raw.get("tags", [])
    card_data = raw.get("cardData", {}) or {}

    # Build clean name from model_id
    name_part = model_id.split("/")[-1] if "/" in model_id else model_id
    # Make it human-readable
    name = name_part.replace("-", " ").replace("_", " ")
    # Capitalize each word
    name = " ".join(w.capitalize() if not w.isupper() else w for w in name.split())

    family = _detect_family(model_id, tags)
    size_label = _estimate_size(model_id, tags)
    languages = _parse_languages(tags)

    # Extract license
    license_val = raw.get("license") or card_data.get("license", "unknown")

    # Description from card_data
    description = ""
    if card_data.get("model_description"):
        description = str(card_data["model_description"])[:200]

    # Filter tags to useful ones
    clean_tags = []
    skip_prefixes = ("arxiv:", "base_model:", "language:", "license:", "doi:", "region:")
    for t in tags:
        if not any(t.startswith(p) for p in skip_prefixes) and len(t) < 30:
            clean_tags.append(t)

    # created_at
    created_at = ""
    if raw.get("createdAt"):
        created_at = raw["createdAt"][:10]

    return {
        "id": model_id,
        "name": name,
        "family": family,
        "size_label": size_label,
        "downloads": raw.get("downloads", 0) or 0,
        "likes": raw.get("likes", 0) or 0,
        "tags": clean_tags[:10],
        "languages": languages[:5],
        "description": description,
        "license": license_val,
        "is_cached": _is_cached(model_id),
        "created_at": created_at,
    }


def _fetch_hf_models(author: str, limit: int = 100) -> list[dict]:
    """Fetch models from HuggingFace API for a given author."""
    params = urllib.parse.urlencode({
        "author": author,
        "sort": "downloads",
        "limit": limit,
        "filter": "text-generation",
        "full": "true",
    })
    url = f"https://huggingface.co/api/models?{params}"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Groot-ModelHub/1.0"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data if isinstance(data, list) else []
    except Exception as e:
        print(f"[hub] HF API error for {author}: {e}")
        return []


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/models")
async def list_hub_models():
    """List models from mlx-community + lmstudio-community, cached 1h."""
    global _models_cache
    now = time.time()

    if _models_cache.get("ts") and now - _models_cache["ts"] < CACHE_TTL:
        return {"models": _models_cache["data"], "cached": True}

    # Fetch from HF API (run in thread pool to avoid blocking)
    loop = asyncio.get_event_loop()
    mlx_raw, lms_raw = await asyncio.gather(
        loop.run_in_executor(None, _fetch_hf_models, "mlx-community", 100),
        loop.run_in_executor(None, _fetch_hf_models, "lmstudio-community", 50),
    )

    combined = mlx_raw + lms_raw
    # Deduplicate by id
    seen = set()
    unique = []
    for m in combined:
        mid = m.get("id", "")
        if mid and mid not in seen:
            seen.add(mid)
            unique.append(m)

    # Parse & enrich
    parsed = [_parse_model(m) for m in unique]
    # Sort by downloads desc
    parsed.sort(key=lambda x: x["downloads"], reverse=True)

    _models_cache = {"data": parsed, "ts": now}
    return {"models": parsed, "cached": False}


@router.post("/invalidate-cache")
async def invalidate_cache():
    """Force-invalidate the models cache."""
    global _models_cache
    _models_cache = {}
    return {"status": "cache invalidated"}


class DownloadRequest(BaseModel):
    model_id: str


@router.post("/download")
async def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    """Start downloading a model in the background."""
    model_id = req.model_id
    if not model_id or "/" not in model_id:
        raise HTTPException(400, "Invalid model_id (expected 'author/repo')")

    if model_id in _download_status and _download_status[model_id].get("status") == "downloading":
        return {"download_id": model_id, "status": "already_downloading"}

    _download_status[model_id] = {
        "status": "downloading",
        "progress": 0,
        "size_downloaded": 0,
        "speed": 0,
        "error": None,
    }

    background_tasks.add_task(_download_model, model_id)
    return {"download_id": model_id, "status": "started"}


async def _download_model(model_id: str):
    """Background task: download model via huggingface_hub."""
    try:
        # Run blocking download in thread pool
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _sync_download, model_id)
        _download_status[model_id]["status"] = "done"
        _download_status[model_id]["progress"] = 100
        # Invalidate models cache so is_cached updates
        global _models_cache
        _models_cache = {}
    except Exception as e:
        _download_status[model_id]["status"] = "error"
        _download_status[model_id]["error"] = str(e)
        print(f"[hub] Download error for {model_id}: {e}")


def _sync_download(model_id: str):
    """Synchronous download using huggingface_hub."""
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=model_id,
            local_dir=None,  # uses default HF cache
            ignore_patterns=["*.md", "*.txt", "*.jpg", "*.png", "*.gif"],
        )
    except ImportError:
        # Fallback: use huggingface-cli
        import subprocess
        result = subprocess.run(
            ["/opt/homebrew/bin/python3", "-c",
             f"from huggingface_hub import snapshot_download; snapshot_download('{model_id}')"],
            capture_output=True, text=True, timeout=3600
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr)


def _get_download_progress(model_id: str) -> dict:
    """Estimate download progress from cache directory size."""
    cache_name = "models--" + model_id.replace("/", "--")
    cache_path = HF_CACHE_DIR / cache_name

    status = _download_status.get(model_id, {})
    current_status = status.get("status", "unknown")

    size_downloaded = 0
    if cache_path.exists():
        try:
            total = sum(f.stat().st_size for f in cache_path.rglob("*") if f.is_file())
            size_downloaded = total
        except Exception:
            pass

    progress = status.get("progress", 0)
    if current_status == "done":
        progress = 100
    elif current_status == "downloading" and size_downloaded > 0:
        # Rough progress estimate based on incomplete files
        progress = min(95, int(size_downloaded / (1024 * 1024 * 100) * 10))

    return {
        "status": current_status,
        "progress": progress,
        "size_downloaded": size_downloaded,
        "speed": status.get("speed", 0),
        "error": status.get("error"),
    }


@router.get("/download/{model_id_encoded}/status")
async def download_status_stream(model_id_encoded: str):
    """SSE stream for download progress."""
    model_id = urllib.parse.unquote(model_id_encoded)

    async def event_stream():
        while True:
            info = _get_download_progress(model_id)
            yield f"data: {json.dumps(info)}\n\n"

            if info["status"] in ("done", "error", "unknown"):
                break
            await asyncio.sleep(2)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/cached")
async def list_cached_models():
    """List all locally cached HuggingFace models."""
    if not HF_CACHE_DIR.exists():
        return {"models": [], "total_size_bytes": 0}

    cached = []
    total_size = 0

    for entry in HF_CACHE_DIR.iterdir():
        if not entry.is_dir():
            continue
        if not entry.name.startswith("models--"):
            continue

        # Parse model_id from directory name
        raw = entry.name[len("models--"):]
        model_id = raw.replace("--", "/", 1)

        # Calculate size
        try:
            dir_size = sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
        except Exception:
            dir_size = 0

        total_size += dir_size

        cached.append({
            "model_id": model_id,
            "cache_path": str(entry),
            "size_bytes": dir_size,
            "size_label": _bytes_to_label(dir_size),
        })

    cached.sort(key=lambda x: x["size_bytes"], reverse=True)
    return {"models": cached, "total_size_bytes": total_size, "total_size_label": _bytes_to_label(total_size)}


@router.get("/available-for-training")
async def available_for_training():
    """List cached models that are suitable for LoRA training (MLX format)."""
    if not HF_CACHE_DIR.exists():
        return {"models": []}

    trainable = []
    for entry in HF_CACHE_DIR.iterdir():
        if not entry.is_dir() or not entry.name.startswith("models--"):
            continue

        raw = entry.name[len("models--"):]
        model_id = raw.replace("--", "/", 1)

        # Check for MLX config or pytorch weights
        snapshots = entry / "snapshots"
        has_mlx = False
        if snapshots.exists():
            for snap in snapshots.iterdir():
                if snap.is_dir():
                    files = list(snap.iterdir())
                    file_names = [f.name for f in files]
                    if any("config.json" in n for n in file_names):
                        has_mlx = True
                        break

        if not has_mlx:
            continue

        name_part = model_id.split("/")[-1]
        name = name_part.replace("-", " ").replace("_", " ")
        name = " ".join(w.capitalize() if not w.isupper() else w for w in name.split())

        try:
            dir_size = sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
        except Exception:
            dir_size = 0

        trainable.append({
            "id": model_id,
            "name": name,
            "size": _bytes_to_label(dir_size),
            "quality": "Gut",
            "languages": "Mehrsprachig",
            "train_time": "~?",
            "recommended_for": "Lokal gecacht",
        })

    return {"models": trainable}


def _bytes_to_label(b: int) -> str:
    if b >= 1024 ** 3:
        return f"~{b / 1024**3:.1f} GB"
    elif b >= 1024 ** 2:
        return f"~{b / 1024**2:.0f} MB"
    else:
        return f"~{b / 1024:.0f} KB"
