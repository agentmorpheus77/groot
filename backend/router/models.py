"""
Groot – Model Library Router
"""
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import get_db, dict_from_row, now_iso
from training import run_inference, run_adapter_inference

router = APIRouter(prefix="/api/models", tags=["models"])


LUTZ_SYSTEM_PROMPT = (
    "Du bist der offizielle digitale Assistent der LUTZ-JESCO GmbH – einem führenden deutschen Hersteller von Dosier- und Förderpumpen, Chlorgas-Anlagen, Vakuumreglern und Sicherheitstechnik für die Wasseraufbereitung und Industrie. "
    "Dein Name ist LUTZ-JESCO Assistent. "
    "Du sprichst natürliches, fließendes Deutsch wie ein kompetenter Mitarbeiter. "
    "PRODUKTPORTFOLIO von LUTZ-JESCO: "
    "Produktserien: Dosierpumpen (Membrandosierpumpen, Schlauchpumpen), "
    "Chlorgas-Vakuumregler (Modelle: C 2210, C 2213, C 2214, C 2215, C 2216, C 2217, C 2270, C 2526, C 2700, C 2701), "
    "Chloranlagen und ChlorStop-Sicherheitssysteme, "
    "Regler und Steuerungen (C 6100, C 6420, C 6421, C 7105, C 7110, C 7520, C 7522, C 7523, C 7524, C 7700). "
    "Anwendungsbereiche: Trinkwasseraufbereitung, Schwimmbadtechnik, Industrie, Abwasserbehandlung. "
    "Antworte direkt und hilfreich – ohne 'Leider' am Anfang wenn du Infos hast. "
    "Sage NIE 'Wissensgraph', 'Entitäten' oder technische Metadaten. "
    "Wenn du wirklich keine Infos hast: kurz und freundlich, Verweis auf Kundenservice +49 (0)5136 899-0 oder www.lutz-jesco.com."
)

class ChatRequest(BaseModel):
    prompt: str
    max_tokens: int = 256
    system_prompt: str = LUTZ_SYSTEM_PROMPT


@router.get("")
async def list_models():
    conn = get_db()
    rows = conn.execute("SELECT * FROM models ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict_from_row(r) for r in rows]


@router.get("/{model_id}")
async def get_model(model_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM models WHERE id=?", (model_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Model not found")
    return dict_from_row(row)


@router.post("/{model_id}/chat")
async def chat_with_model(model_id: int, req: ChatRequest):
    conn = get_db()
    row = dict_from_row(conn.execute("SELECT * FROM models WHERE id=?", (model_id,)).fetchone())
    conn.close()

    if not row:
        raise HTTPException(404, "Model not found")

    if row.get("fused_path") and Path(row["fused_path"]).exists():
        # Use fused model
        response = await run_inference(row["fused_path"], req.prompt, req.max_tokens, req.system_prompt)
    elif row.get("adapter_path") and Path(row["adapter_path"]).exists():
        # Use adapter + base model
        response = await run_adapter_inference(
            row["base_model"], row["adapter_path"], req.prompt, req.max_tokens, req.system_prompt
        )
    else:
        raise HTTPException(400, "Model files not found. Please retrain.")

    return {
        "model_id": model_id,
        "model_name": row["name"],
        "prompt": req.prompt,
        "response": response,
    }


@router.delete("/{model_id}")
async def delete_model(model_id: int):
    conn = get_db()
    row = dict_from_row(conn.execute("SELECT * FROM models WHERE id=?", (model_id,)).fetchone())
    if not row:
        conn.close()
        raise HTTPException(404, "Model not found")

    # Delete files
    for path_key in ("fused_path", "adapter_path"):
        p = row.get(path_key)
        if p and Path(p).exists():
            shutil.rmtree(p, ignore_errors=True)

    conn.execute("DELETE FROM models WHERE id=?", (model_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted", "id": model_id}


@router.get("/stats/summary")
async def stats_summary():
    conn = get_db()
    datasets = conn.execute("SELECT COUNT(*) as c FROM datasets").fetchone()["c"]
    jobs = conn.execute("SELECT COUNT(*) as c FROM jobs").fetchone()["c"]
    models = conn.execute("SELECT COUNT(*) as c FROM models").fetchone()["c"]
    running = conn.execute("SELECT COUNT(*) as c FROM jobs WHERE status='running'").fetchone()["c"]
    conn.close()
    return {
        "datasets": datasets,
        "jobs": jobs,
        "models": models,
        "running_jobs": running,
    }
