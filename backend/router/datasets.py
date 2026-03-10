"""
Groot – Dataset Router
"""
import json
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from database import get_db, dict_from_row, now_iso
from training import DATASETS_DIR, convert_dataset_to_mlx

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.post("")
async def upload_dataset(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".jsonl", ".json", ".csv"):
        raise HTTPException(400, "Only .jsonl, .json, .csv files supported")

    # Save uploaded file temporarily
    tmp_path = DATASETS_DIR / f"_tmp_{file.filename}"
    with open(tmp_path, "wb") as f:
        content = await file.read()
        f.write(content)

    try:
        # Create a DB entry first to get an ID
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO datasets (name, filename, file_path, row_count, format, created_at) VALUES (?,?,?,?,?,?)",
            (Path(file.filename).stem, file.filename, "", 0, suffix.lstrip("."), now_iso())
        )
        dataset_id = cur.lastrowid
        conn.commit()

        # Convert dataset
        out_dir = DATASETS_DIR / str(dataset_id)
        row_count = await convert_dataset_to_mlx(tmp_path, out_dir)

        # Also copy original file
        shutil.copy(tmp_path, out_dir / file.filename)

        # Update DB
        cur.execute(
            "UPDATE datasets SET file_path=?, row_count=? WHERE id=?",
            (str(out_dir), row_count, dataset_id)
        )
        conn.commit()

        row = cur.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()
        conn.close()
        tmp_path.unlink(missing_ok=True)

        return dict_from_row(row)

    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        # Clean up DB entry if creation failed
        try:
            conn.execute("DELETE FROM datasets WHERE id=?", (dataset_id,))
            conn.commit()
            conn.close()
        except Exception:
            pass
        raise HTTPException(400, str(e))


@router.get("")
async def list_datasets():
    conn = get_db()
    rows = conn.execute("SELECT * FROM datasets ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict_from_row(r) for r in rows]


@router.get("/{dataset_id}")
async def get_dataset(dataset_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Dataset not found")
    return dict_from_row(row)


@router.get("/{dataset_id}/preview")
async def preview_dataset(dataset_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Dataset not found")

    train_file = Path(row["file_path"]) / "train.jsonl"
    if not train_file.exists():
        raise HTTPException(404, "Dataset files not found")

    rows = []
    with open(train_file, "r") as f:
        for i, line in enumerate(f):
            if i >= 10:
                break
            try:
                rows.append(json.loads(line.strip()))
            except Exception:
                pass

    return {"rows": rows, "total": row["row_count"]}


@router.delete("/{dataset_id}")
async def delete_dataset(dataset_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Dataset not found")

    # Remove files
    dataset_dir = Path(row["file_path"])
    if dataset_dir.exists():
        shutil.rmtree(dataset_dir)

    conn.execute("DELETE FROM datasets WHERE id=?", (dataset_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted", "id": dataset_id}
