"""
Groot – Learnings Router
Protocol of training insights, bug fixes, and research findings.
"""
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from database import get_db, dict_from_row, now_iso

router = APIRouter(prefix="/api/learnings", tags=["learnings"])

# ── Seed data ──────────────────────────────────────────────────────────────
SEED_LEARNINGS = [
    {
        "title": "Chat Template Mismatch Bug (12.03.2026)",
        "source": "training",
        "model": "DeepSeek-R1-Qwen3-8B",
        "tags": "template,bug,fix",
        "url": None,
        "job_id": None,
        "content": (
            "PROBLEM: Training verwendete Llama [INST]...[/INST] Format, "
            "aber das Base-Model war Qwen3/DeepSeek. Qwen3 erwartet "
            "<|im_start|>/<|im_end|> Chat Template.\n\n"
            "FIX: convert_dataset_to_mlx() schreibt jetzt Qwen3 Chat Template:\n"
            "<|im_start|>system\\n...\\n<|im_end|>\\n"
            "<|im_start|>user\\n{prompt}\\n<|im_end|>\\n"
            "<|im_start|>assistant\\n{completion}<|im_end|>\n\n"
            "REGEL: Training-Format MUSS exakt dem Inference-Format entsprechen! "
            "Nie Llama-Template mit Qwen3-Modell mischen."
        ),
    },
    {
        "title": "Sequence Truncation — Pre-Split Data (12.03.2026)",
        "source": "training",
        "model": None,
        "tags": "dataset,memory,split,performance",
        "url": None,
        "job_id": None,
        "content": (
            "PROBLEM: 28% aller Trainings-Beispiele (4.199 von 15.644) waren länger "
            "als 512 Tokens. MLX schnitt hart ab — Modell lernte unvollständige Antworten. "
            "Längste Sequenz: 2.039 Tokens!\n\n"
            "FIX: Intelligentes Splitting in convert_dataset_to_mlx() — Antworten werden "
            "an Absatz/Satz-Grenzen aufgeteilt.\n\n"
            "ERGEBNIS: 15.644 → 20.544 Training-Rows, Max 470 Tokens, kein Data Loss mehr.\n\n"
            "FORMEL: budget_chars = (max_tokens - prompt_tokens) × chars_per_token\n\n"
            "NÄCHSTES MAL: Immer zuerst Sequenz-Längen analysieren bevor Training startet. "
            "Warning 'Consider pre-splitting' = sofort handeln!"
        ),
    },
    {
        "title": "Gate-Check Bug in 2-Step Inference Pipeline (12.03.2026)",
        "source": "training",
        "model": None,
        "tags": "inference,bug,fix,pipeline",
        "url": None,
        "job_id": None,
        "content": (
            "PROBLEM: has_knowledge-Check prüfte ob 'keine' oder 'nicht' in den ersten "
            "80 Chars des Adapter-Outputs vorkommt. Das schlug auch bei echten Antworten "
            "an die 'keine' als normales Wort enthielten (z.B. 'Für keine NPS-Werte gilt...').\n\n"
            "SYMPTOM: Modell antwortete immer 'Leider keine Produktinformationen' obwohl "
            "es trainiert wurde.\n\n"
            "FIX: Nur auf spezifische Fehler-Phrasen prüfen:\n"
            "- 'keine spezifischen informationen'\n"
            "- 'keine informationen'\n"
            "- 'wissensbankabfrage hat zu lange'\n"
            "- 'fehler bei wissensbankabfrage'\n\n"
            "NÄCHSTES MAL: Gate-Checks nie auf einzelne häufige Wörter bauen."
        ),
    },
    {
        "title": "8B Modell zu langsam für iteratives Fine-Tuning (12.03.2026)",
        "source": "training",
        "model": "DeepSeek-R1-Qwen3-8B",
        "tags": "performance,model-choice,speed",
        "url": None,
        "job_id": None,
        "content": (
            "PROBLEM: 20k Iters auf 8B Modell = 5-6 Stunden Trainingszeit. "
            "Zu lang für schnelle Iteration und Bug-Fixes.\n\n"
            "LÖSUNG: Qwen3-4B-Instruct-2507-4bit als Standard für Lutz-Jesco Training:\n"
            "- Bereits lokal verfügbar\n"
            "- Bereits in Inference-Pipeline Step 2 verwendet\n"
            "- Chat Template identisch → kein Mismatch möglich\n"
            "- 10k Iters in ~3-4 Stunden\n\n"
            "FAUSTREGEL: 1.7B für schnelle Tests (<1h), 4B für Produktion (~3-4h), "
            "8B nur wenn Qualität es wirklich erfordert."
        ),
    },
    {
        "title": "Metal GPU Crash — val-batches limitieren (12.03.2026)",
        "source": "training",
        "model": "Qwen3-4B",
        "tags": "gpu,memory,validation,crash",
        "url": None,
        "job_id": None,
        "content": (
            "PROBLEM: Training crashte mit '[METAL] Command buffer execution failed: "
            "Impacting Interactivity' während Validierungsphase.\n\n"
            "URSACHE: MLX validiert standardmäßig auf dem GESAMTEN Validation-Set. "
            "Nach Pre-Split hatten wir 2.122 Validation-Rows → zu viel für einen "
            "einzelnen Metal Command Buffer.\n\n"
            "FIX: '--val-batches 25' in den Training-Command → limitiert Validation "
            "auf 25 Batches statt alle.\n\n"
            "ZUSATZ: '--num-layers 8' statt 16 für LoRA → weniger RAM-Verbrauch.\n\n"
            "PEAK RAM nach Fix: 3.793 GB (deutlich weniger)."
        ),
    },
]


def ensure_table():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS learnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            source TEXT DEFAULT 'manual',
            model TEXT,
            job_id INTEGER,
            tags TEXT,
            url TEXT,
            created_at TEXT
        )
    """)
    conn.commit()

    # Seed if empty
    count = conn.execute("SELECT COUNT(*) FROM learnings").fetchone()[0]
    if count == 0:
        for s in SEED_LEARNINGS:
            conn.execute(
                "INSERT INTO learnings (title, content, source, model, job_id, tags, url, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (s["title"], s["content"], s["source"], s["model"],
                 s["job_id"], s["tags"], s["url"], now_iso())
            )
        conn.commit()
    conn.close()


# Run on import
ensure_table()


class LearningCreate(BaseModel):
    title: str
    content: str
    source: str = "manual"
    model: Optional[str] = None
    job_id: Optional[int] = None
    tags: Optional[str] = None
    url: Optional[str] = None


@router.get("")
async def list_learnings(
    source: Optional[str] = None,
    model: Optional[str] = None,
    tag: Optional[str] = None,
    q: Optional[str] = None,
):
    conn = get_db()
    sql = "SELECT * FROM learnings WHERE 1=1"
    params = []

    if source:
        sql += " AND source = ?"
        params.append(source)
    if model:
        sql += " AND model LIKE ?"
        params.append(f"%{model}%")
    if tag:
        sql += " AND (',' || tags || ',') LIKE ?"
        params.append(f"%,{tag},%")
    if q:
        sql += " AND (title LIKE ? OR content LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%"])

    sql += " ORDER BY created_at DESC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict_from_row(r) for r in rows]


@router.get("/tags")
async def list_tags():
    conn = get_db()
    rows = conn.execute("SELECT tags FROM learnings WHERE tags IS NOT NULL AND tags != ''").fetchall()
    conn.close()
    all_tags = set()
    for row in rows:
        for tag in row[0].split(","):
            t = tag.strip()
            if t:
                all_tags.add(t)
    return sorted(all_tags)


@router.post("")
async def create_learning(req: LearningCreate):
    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO learnings (title, content, source, model, job_id, tags, url, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (req.title, req.content, req.source, req.model,
         req.job_id, req.tags, req.url, now_iso())
    )
    conn.commit()
    row = dict_from_row(conn.execute("SELECT * FROM learnings WHERE id=?", (cursor.lastrowid,)).fetchone())
    conn.close()
    return row


@router.delete("/{learning_id}")
async def delete_learning(learning_id: int):
    conn = get_db()
    row = conn.execute("SELECT id FROM learnings WHERE id=?", (learning_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Learning not found")
    conn.execute("DELETE FROM learnings WHERE id=?", (learning_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted", "id": learning_id}
