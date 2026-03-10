"""
Groot – Training Jobs Router
"""
import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from database import get_db, dict_from_row, now_iso
from training import (
    run_training_job, run_fuse_model,
    get_log_queue, clear_log_queue,
    ADAPTERS_DIR, DATASETS_DIR,
)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

BASE_MODELS = [
    # ── Qwen3 (neueste Generation, März 2026) ────────────────────────────
    {
        "id": "mlx-community/Qwen3-1.7B-4bit",
        "name": "Qwen3 1.7B (4-bit) 🆕",
        "size": "~1.1 GB",
        "quality": "Gut",
        "languages": "DE, EN, ZH, +29",
        "train_time": "~5 Min",
        "recommended_for": "Schnelle Tests (neuestes Qwen)",
    },
    {
        "id": "mlx-community/Qwen3-4B-Instruct-2507-4bit",
        "name": "Qwen3 4B Instruct (4-bit) 🆕",
        "size": "~2.5 GB",
        "quality": "Sehr gut",
        "languages": "DE, EN, ZH, +29",
        "train_time": "~12 Min",
        "recommended_for": "Beste Qualität/Speed-Balance ⭐",
    },
    {
        "id": "lmstudio-community/DeepSeek-R1-0528-Qwen3-8B-MLX-4bit",
        "name": "Qwen3 8B (DeepSeek R1, 4-bit) 🆕",
        "size": "~5 GB",
        "quality": "Exzellent",
        "languages": "DE, EN, ZH, +29",
        "train_time": "~25 Min",
        "recommended_for": "Produktion + Reasoning ⭐⭐",
    },
    # ── Llama 3 ──────────────────────────────────────────────────────────
    {
        "id": "mlx-community/Llama-3.2-1B-Instruct-4bit",
        "name": "Llama 3.2 1B Instruct (4-bit)",
        "size": "~800 MB",
        "quality": "Basis",
        "languages": "DE, EN, +20",
        "train_time": "~2 Min",
        "recommended_for": "Schnellste Tests",
    },
    {
        "id": "mlx-community/Llama-3.2-3B-Instruct-4bit",
        "name": "Llama 3.2 3B Instruct (4-bit)",
        "size": "~2 GB",
        "quality": "Gut",
        "languages": "DE, EN, +20",
        "train_time": "~8 Min",
        "recommended_for": "Kleine Projekte",
    },
    {
        "id": "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit",
        "name": "Llama 3.1 8B Instruct (4-bit)",
        "size": "~5 GB",
        "quality": "Sehr gut",
        "languages": "DE, EN, +30",
        "train_time": "~25 Min",
        "recommended_for": "Produktion",
    },
    # ── Mistral / Gemma ──────────────────────────────────────────────────
    {
        "id": "mlx-community/Mistral-7B-Instruct-v0.3-4bit",
        "name": "Mistral 7B Instruct v0.3 (4-bit)",
        "size": "~4 GB",
        "quality": "Sehr gut",
        "languages": "DE, EN, FR, +",
        "train_time": "~20 Min",
        "recommended_for": "Europäische Sprachen",
    },
    {
        "id": "mlx-community/gemma-3-4b-it-4bit",
        "name": "Gemma 3 4B Instruct (4-bit)",
        "size": "~3 GB",
        "quality": "Sehr gut",
        "languages": "DE, EN, +35",
        "train_time": "~12 Min",
        "recommended_for": "Google-Modell",
    },
]


class CreateJobRequest(BaseModel):
    name: str
    dataset_id: int
    base_model: str
    epochs: int = 3
    learning_rate: float = 1e-4
    max_seq_length: int = 512
    batch_size: int = 4
    iters: int = 100


@router.get("/models")
async def list_base_models():
    return {"models": BASE_MODELS}


@router.post("")
async def create_job(req: CreateJobRequest, background_tasks: BackgroundTasks):
    if req.base_model not in BASE_MODELS:
        raise HTTPException(400, f"Unknown base model. Choose from: {BASE_MODELS}")

    # Check dataset exists
    conn = get_db()
    ds = conn.execute("SELECT * FROM datasets WHERE id=?", (req.dataset_id,)).fetchone()
    if not ds:
        conn.close()
        raise HTTPException(404, "Dataset not found")

    cur = conn.cursor()
    cur.execute(
        """INSERT INTO jobs (name, dataset_id, base_model, status, epochs, learning_rate,
           max_seq_length, batch_size, iters, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (req.name, req.dataset_id, req.base_model, "queued",
         req.epochs, req.learning_rate, req.max_seq_length,
         req.batch_size, req.iters, now_iso())
    )
    job_id = cur.lastrowid
    conn.commit()
    row = cur.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    conn.close()

    # Start training in background
    background_tasks.add_task(
        _start_training, job_id, req.dataset_id, req.base_model,
        req.epochs, req.learning_rate, req.max_seq_length,
        req.batch_size, req.iters
    )

    return dict_from_row(row)


async def _start_training(
    job_id: int, dataset_id: int, base_model: str,
    epochs: int, learning_rate: float, max_seq_length: int,
    batch_size: int, iters: int
):
    conn = get_db()
    conn.execute(
        "UPDATE jobs SET status='running', started_at=? WHERE id=?",
        (now_iso(), job_id)
    )
    conn.commit()
    conn.close()

    async def on_status_change(status: str, error: str = None, loss: float = None, adapter_path: str = None):
        conn = get_db()
        if status == "completed":
            conn.execute(
                "UPDATE jobs SET status=?, finished_at=?, final_loss=?, adapter_path=? WHERE id=?",
                (status, now_iso(), loss, adapter_path, job_id)
            )
            conn.commit()

            # Auto-register model
            job_row = dict_from_row(conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())
            ds_row = dict_from_row(conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone())

            started = datetime.fromisoformat(job_row["started_at"]) if job_row.get("started_at") else None
            finished = datetime.utcnow()
            duration = int((finished - started).total_seconds()) if started else 0

            conn.execute(
                """INSERT INTO models (name, job_id, base_model, adapter_path, dataset_name,
                   training_time_seconds, final_loss, created_at, status)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (f"{job_row['name']} (adapter)",
                 job_id, base_model, adapter_path,
                 ds_row["name"] if ds_row else "Unknown",
                 duration, loss, now_iso(), "ready")
            )
            conn.commit()
        else:
            conn.execute(
                "UPDATE jobs SET status=?, finished_at=?, error_message=? WHERE id=?",
                (status, now_iso(), error, job_id)
            )
            conn.commit()
        conn.close()

    await run_training_job(
        job_id=job_id,
        dataset_id=dataset_id,
        base_model=base_model,
        epochs=epochs,
        learning_rate=learning_rate,
        max_seq_length=max_seq_length,
        batch_size=batch_size,
        iters=iters,
        on_status_change=on_status_change,
    )


@router.get("")
async def list_jobs():
    conn = get_db()
    rows = conn.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict_from_row(r) for r in rows]


@router.get("/{job_id}")
async def get_job(job_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Job not found")
    return dict_from_row(row)


@router.get("/{job_id}/logs")
async def stream_logs(job_id: int):
    """SSE endpoint: streams training logs in real-time"""
    queue = get_log_queue(job_id)

    # Also send historical logs from log file if job already ran
    conn = get_db()
    job = dict_from_row(conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())
    conn.close()

    if not job:
        raise HTTPException(404, "Job not found")

    async def event_stream():
        # Send initial status
        yield f"data: {json.dumps({'type': 'status', 'status': job['status']})}\n\n"

        if job["status"] in ("completed", "failed"):
            # Job is done, no live logs available - send summary
            summary_msg = f"Job {job['status']}. Final loss: {job.get('final_loss')}"
            yield f"data: {json.dumps({'type': 'info', 'msg': summary_msg})}\n\n"
            if job.get("error_message"):
                err_msg = job["error_message"]
                yield f"data: {json.dumps({'type': 'error', 'msg': err_msg})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'msg': '__STREAM_END__'})}\n\n"
            return

        # Stream live logs
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=30.0)
                yield f"data: {json.dumps(msg)}\n\n"
                if msg.get("msg") == "__STREAM_END__":
                    break
            except asyncio.TimeoutError:
                # Send keepalive
                yield f"data: {json.dumps({'type': 'ping'})}\n\n"
                # Check if job finished
                conn = get_db()
                job_now = dict_from_row(conn.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone())
                conn.close()
                if job_now and job_now["status"] in ("completed", "failed"):
                    yield f"data: {json.dumps({'type': 'done', 'msg': '__STREAM_END__'})}\n\n"
                    break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


@router.delete("/{job_id}")
async def delete_job(job_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Job not found")

    conn.execute("DELETE FROM jobs WHERE id=?", (job_id,))
    conn.commit()
    conn.close()
    clear_log_queue(job_id)
    return {"status": "deleted", "id": job_id}
