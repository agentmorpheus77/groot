"""
Groot – Whisper Fine-Tuning Router
Fine-tune Whisper auf Fachvokabular (Lutz-Jesco, CDBrain, etc.)
"""
import asyncio
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel

from database import get_db, dict_from_row, now_iso

router = APIRouter(prefix="/api/whisper", tags=["whisper"])

DATA_DIR = Path(__file__).parent.parent.parent / "data"
WHISPER_DIR = DATA_DIR / "whisper"
WHISPER_DATASETS_DIR = WHISPER_DIR / "datasets"
WHISPER_MODELS_DIR = WHISPER_DIR / "models"
WHISPER_AUDIO_DIR = WHISPER_DIR / "audio"

for d in [WHISPER_DIR, WHISPER_DATASETS_DIR, WHISPER_MODELS_DIR, WHISPER_AUDIO_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# In-memory log queues
_whisper_log_queues: dict[int, asyncio.Queue] = {}
_whisper_processes: dict[int, subprocess.Popen] = {}

# Available base models
WHISPER_BASE_MODELS = [
    {"id": "mlx-community/whisper-tiny-mlx", "name": "Whisper Tiny (MLX)", "size": "~75 MB", "wer": "~10%", "speed": "Sehr schnell"},
    {"id": "mlx-community/whisper-small-mlx", "name": "Whisper Small (MLX)", "size": "~244 MB", "wer": "~6%", "speed": "Schnell"},
    {"id": "mlx-community/whisper-medium-mlx", "name": "Whisper Medium (MLX)", "size": "~769 MB", "wer": "~4%", "speed": "Mittel"},
    {"id": "openai/whisper-small", "name": "Whisper Small (HuggingFace)", "size": "~244 MB", "wer": "~6%", "speed": "Schnell"},
    {"id": "openai/whisper-medium", "name": "Whisper Medium (HuggingFace)", "size": "~769 MB", "wer": "~4%", "speed": "Mittel"},
]

# Seed-Vokabular für Lutz-Jesco (nur für initiales DB-Seeding)
LUTZ_VOCABULARY_SEED = [
    # Produktnamen / Modelle
    "Dosierventil", "Dosierpumpe", "Membrandosierpumpe", "Schlauchpumpe",
    "Chlorgas", "Vakuumregler", "ChlorStop",
    "C 2210", "C 2213", "C 2214", "C 2215", "C 2216", "C 2217",
    "C 2270", "C 2526", "C 2700", "C 2701",
    "C 6100", "C 6420", "C 6421", "C 7105", "C 7110",
    "C 7520", "C 7522", "C 7523", "C 7524", "C 7700",
    # Fachbegriffe
    "Wasseraufbereitung", "Trinkwasseraufbereitung", "Schwimmbadtechnik",
    "Abwasserbehandlung", "Dosieranlage", "Förderpumpe",
    "Chlordioxid", "Natriumhypochlorit", "Chloraminierung",
    "NPS", "Potentiostat", "Scrubber", "Lüftungskanal",
    "GOST-Norm", "PVC-U", "Salpetersäure", "Chlorgas-Vakuumregler",
    "HSWD-Regulations", "Hazardous Substances",
    # Lutz-Jesco spezifisch
    "LUTZ-JESCO", "Lutz-Jesco", "Lutz Jesco",
    "lutz-jesco.com", "Jeveka",
]


def ensure_whisper_table():
    conn = get_db()
    # Vocabulary Sets — ein Set pro Domäne (Lutz-Jesco, CDBrain, etc.)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS whisper_vocabularies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            language TEXT DEFAULT 'de',
            terms TEXT DEFAULT '[]',
            created_at TEXT,
            updated_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS whisper_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            dataset_id INTEGER,
            base_model TEXT NOT NULL,
            status TEXT DEFAULT 'queued',
            epochs INTEGER DEFAULT 3,
            learning_rate REAL DEFAULT 0.0001,
            batch_size INTEGER DEFAULT 4,
            max_steps INTEGER DEFAULT 1000,
            adapter_path TEXT,
            started_at TEXT,
            finished_at TEXT,
            created_at TEXT,
            error_message TEXT,
            final_wer REAL,
            metadata TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS whisper_datasets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            vocabulary_id INTEGER,
            audio_count INTEGER DEFAULT 0,
            total_duration_sec REAL DEFAULT 0,
            language TEXT DEFAULT 'de',
            vocabulary_count INTEGER DEFAULT 0,
            created_at TEXT,
            metadata TEXT
        )
    """)
    conn.commit()

    # Lutz-Jesco Seed-Vokabular als erstes Vocabulary-Set anlegen (falls noch nicht da)
    existing = conn.execute("SELECT id FROM whisper_vocabularies WHERE name='Lutz-Jesco Fachvokabular'").fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO whisper_vocabularies (name, description, language, terms, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            ("Lutz-Jesco Fachvokabular",
             "Produktnamen, Modelle und Fachbegriffe aus dem Lutz-Jesco Katalog",
             "de",
             json.dumps(LUTZ_VOCABULARY_SEED, ensure_ascii=False),
             now_iso(), now_iso())
        )
        conn.commit()
    conn.close()


ensure_whisper_table()


# ── Models ──────────────────────────────────────────────────────────────────

@router.get("/base-models")
async def list_base_models():
    return WHISPER_BASE_MODELS


@router.get("/models")
async def list_whisper_models():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM whisper_jobs WHERE status='completed' ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict_from_row(r) for r in rows]


# ── Vocabulary CRUD ──────────────────────────────────────────────────────────

class VocabularyCreate(BaseModel):
    name: str
    description: str = ""
    language: str = "de"
    terms: list[str] = []

class VocabularyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    language: Optional[str] = None
    terms: Optional[list[str]] = None

@router.get("/vocabularies")
async def list_vocabularies():
    conn = get_db()
    rows = conn.execute("SELECT * FROM whisper_vocabularies ORDER BY created_at DESC").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict_from_row(r)
        d["terms"] = json.loads(d.get("terms") or "[]")
        d["term_count"] = len(d["terms"])
        result.append(d)
    return result

@router.get("/vocabularies/{vocab_id}")
async def get_vocabulary(vocab_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM whisper_vocabularies WHERE id=?", (vocab_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Vocabulary not found")
    d = dict_from_row(row)
    d["terms"] = json.loads(d.get("terms") or "[]")
    return d

@router.post("/vocabularies")
async def create_vocabulary(req: VocabularyCreate):
    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO whisper_vocabularies (name, description, language, terms, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (req.name, req.description, req.language, json.dumps(req.terms, ensure_ascii=False), now_iso(), now_iso())
    )
    vid = cursor.lastrowid
    conn.commit()
    conn.close()
    return {"id": vid, "name": req.name, "term_count": len(req.terms)}

@router.patch("/vocabularies/{vocab_id}")
async def update_vocabulary(vocab_id: int, req: VocabularyUpdate):
    conn = get_db()
    row = conn.execute("SELECT * FROM whisper_vocabularies WHERE id=?", (vocab_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Vocabulary not found")
    d = dict_from_row(row)
    new_name = req.name if req.name is not None else d["name"]
    new_desc = req.description if req.description is not None else d["description"]
    new_lang = req.language if req.language is not None else d["language"]
    new_terms = req.terms if req.terms is not None else json.loads(d.get("terms") or "[]")
    conn.execute(
        "UPDATE whisper_vocabularies SET name=?, description=?, language=?, terms=?, updated_at=? WHERE id=?",
        (new_name, new_desc, new_lang, json.dumps(new_terms, ensure_ascii=False), now_iso(), vocab_id)
    )
    conn.commit()
    conn.close()
    return {"id": vocab_id, "name": new_name, "term_count": len(new_terms)}

@router.post("/vocabularies/{vocab_id}/terms")
async def add_term(vocab_id: int, body: dict):
    """Einzelnen Begriff hinzufügen."""
    term = (body.get("term") or "").strip()
    if not term:
        raise HTTPException(400, "term required")
    conn = get_db()
    row = conn.execute("SELECT terms FROM whisper_vocabularies WHERE id=?", (vocab_id,)).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Vocabulary not found")
    terms = json.loads(row[0] or "[]")
    if term not in terms:
        terms.append(term)
    conn.execute(
        "UPDATE whisper_vocabularies SET terms=?, updated_at=? WHERE id=?",
        (json.dumps(terms, ensure_ascii=False), now_iso(), vocab_id)
    )
    conn.commit(); conn.close()
    return {"terms": terms, "term_count": len(terms)}

@router.delete("/vocabularies/{vocab_id}/terms")
async def remove_term(vocab_id: int, body: dict):
    """Einzelnen Begriff entfernen."""
    term = (body.get("term") or "").strip()
    conn = get_db()
    row = conn.execute("SELECT terms FROM whisper_vocabularies WHERE id=?", (vocab_id,)).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Not found")
    terms = [t for t in json.loads(row[0] or "[]") if t != term]
    conn.execute(
        "UPDATE whisper_vocabularies SET terms=?, updated_at=? WHERE id=?",
        (json.dumps(terms, ensure_ascii=False), now_iso(), vocab_id)
    )
    conn.commit(); conn.close()
    return {"terms": terms, "term_count": len(terms)}

@router.delete("/vocabularies/{vocab_id}")
async def delete_vocabulary(vocab_id: int):
    conn = get_db()
    conn.execute("DELETE FROM whisper_vocabularies WHERE id=?", (vocab_id,))
    conn.commit(); conn.close()
    return {"ok": True}

# ── Legacy endpoint (backward compat) ────────────────────────────────────────
@router.get("/vocabulary")
async def get_vocabulary_legacy():
    """Legacy: gibt Lutz-Jesco Seed zurück."""
    conn = get_db()
    row = conn.execute("SELECT terms FROM whisper_vocabularies ORDER BY id ASC LIMIT 1").fetchone()
    conn.close()
    terms = json.loads(row[0]) if row else LUTZ_VOCABULARY_SEED
    return {"vocabulary": terms, "count": len(terms)}


@router.get("/datasets")
async def list_datasets():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM whisper_datasets ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict_from_row(r) for r in rows]


class GenerateDatasetRequest(BaseModel):
    name: str
    vocabulary_id: int                        # Referenz auf Vocabulary-Set
    description: str = ""
    tts_voice: str = "rruSEtlKAwIe1cvEmP9J"  # Chris v0.5 ElevenLabs


@router.post("/datasets/generate")
async def generate_dataset(req: GenerateDatasetRequest):
    """
    Generiert synthetisches Audio-Dataset via ElevenLabs TTS.
    Nutzt Terms aus dem gewählten Vocabulary-Set.
    """
    # Vocabulary laden
    conn = get_db()
    vrow = conn.execute("SELECT * FROM whisper_vocabularies WHERE id=?", (req.vocabulary_id,)).fetchone()
    if not vrow:
        conn.close()
        raise HTTPException(404, f"Vocabulary #{req.vocabulary_id} not found")
    vd = dict_from_row(vrow)
    terms = json.loads(vd.get("terms") or "[]")
    language = vd["language"]

    cursor = conn.execute(
        "INSERT INTO whisper_datasets (name, description, vocabulary_id, language, vocabulary_count, created_at, metadata) "
        "VALUES (?,?,?,?,?,?,?)",
        (req.name, req.description, req.vocabulary_id, language, len(terms),
         now_iso(), json.dumps({"status": "generating", "tts_voice": req.tts_voice,
                                 "vocabulary_name": vd["name"]}))
    )
    dataset_id = cursor.lastrowid
    conn.commit()
    conn.close()

    asyncio.create_task(
        _generate_dataset_background(dataset_id, terms, language, req.tts_voice)
    )

    return {"id": dataset_id, "status": "generating", "vocabulary_count": len(terms),
            "vocabulary_name": vd["name"]}


async def _generate_dataset_background(dataset_id: int, vocabulary: list, language: str, voice_id: str):
    """Generiert Audio-Clips via ElevenLabs TTS für jedes Vokabular-Wort."""
    import aiohttp

    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        _update_dataset(dataset_id, error="ELEVENLABS_API_KEY nicht gesetzt")
        return

    dataset_dir = WHISPER_AUDIO_DIR / str(dataset_id)
    dataset_dir.mkdir(parents=True, exist_ok=True)

    # Satz-Templates für jedes Wort
    templates = [
        "{term}",
        "Das ist ein {term}.",
        "Wir verwenden einen {term}.",
        "Der {term} muss kalibriert werden.",
        "Bitte prüfen Sie den {term}.",
    ]

    manifest = []
    audio_count = 0
    total_duration = 0.0

    async with aiohttp.ClientSession() as session:
        for term in vocabulary:
            for i, tmpl in enumerate(templates[:3]):  # 3 Sätze pro Begriff
                text = tmpl.format(term=term)
                filename = f"{audio_count:04d}_{re.sub(r'[^a-z0-9]', '_', term.lower())}_{i}.mp3"
                audio_path = dataset_dir / filename

                try:
                    async with session.post(
                        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                        json={"text": text, "model_id": "eleven_multilingual_v2",
                              "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}},
                        timeout=aiohttp.ClientTimeout(total=30)
                    ) as resp:
                        if resp.status == 200:
                            audio_data = await resp.read()
                            audio_path.write_bytes(audio_data)

                            # MP3 → WAV 16kHz für Whisper
                            wav_path = audio_path.with_suffix(".wav")
                            subprocess.run([
                                "ffmpeg", "-i", str(audio_path),
                                "-ar", "16000", "-ac", "1", "-f", "wav",
                                str(wav_path), "-y", "-loglevel", "quiet"
                            ], capture_output=True)

                            if wav_path.exists():
                                manifest.append({
                                    "audio": str(wav_path),
                                    "text": text,
                                    "term": term,
                                })
                                audio_count += 1
                                total_duration += 2.0  # ~2s pro Clip
                except Exception:
                    continue

                await asyncio.sleep(0.5)  # Rate limiting

    # Manifest speichern
    manifest_path = dataset_dir / "manifest.jsonl"
    with open(manifest_path, "w") as f:
        for item in manifest:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    _update_dataset(dataset_id, audio_count=audio_count, total_duration=total_duration)


def _update_dataset(dataset_id: int, audio_count: int = 0, total_duration: float = 0, error: str = None):
    conn = get_db()
    if error:
        conn.execute(
            "UPDATE whisper_datasets SET metadata=? WHERE id=?",
            (json.dumps({"status": "error", "error": error}), dataset_id)
        )
    else:
        conn.execute(
            "UPDATE whisper_datasets SET audio_count=?, total_duration_sec=?, metadata=? WHERE id=?",
            (audio_count, total_duration, json.dumps({"status": "ready"}), dataset_id)
        )
    conn.commit()
    conn.close()


# ── Training ─────────────────────────────────────────────────────────────────

class WhisperTrainRequest(BaseModel):
    name: str
    base_model: str = "openai/whisper-small"
    dataset_id: int
    epochs: int = 3
    learning_rate: float = 0.0001
    batch_size: int = 4
    max_steps: int = 1000
    language: str = "de"


@router.post("/jobs")
async def create_whisper_job(req: WhisperTrainRequest, background_tasks=None):
    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO whisper_jobs (name, dataset_id, base_model, status, epochs, learning_rate, "
        "batch_size, max_steps, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (req.name, req.dataset_id, req.base_model, "queued",
         req.epochs, req.learning_rate, req.batch_size, req.max_steps, now_iso())
    )
    job_id = cursor.lastrowid
    conn.commit()
    conn.close()

    asyncio.create_task(_run_whisper_training(job_id, req))
    return {"id": job_id, "status": "queued"}


@router.get("/jobs")
async def list_whisper_jobs():
    conn = get_db()
    rows = conn.execute("SELECT * FROM whisper_jobs ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict_from_row(r) for r in rows]


@router.get("/jobs/{job_id}")
async def get_whisper_job(job_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM whisper_jobs WHERE id=?", (job_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Whisper job not found")
    return dict_from_row(row)


@router.get("/jobs/{job_id}/logs")
async def stream_whisper_logs(job_id: int):
    async def event_generator():
        queue = _whisper_log_queues.get(job_id)
        if not queue:
            yield f"data: {json.dumps({'msg': 'No active log stream for this job'})}\n\n"
            return
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=30)
                yield f"data: {json.dumps(item)}\n\n"
                if item.get("msg") == "__STREAM_END__":
                    break
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'type': 'ping'})}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")


async def _run_whisper_training(job_id: int, req: WhisperTrainRequest):
    """Startet Whisper Fine-Tuning via HuggingFace transformers."""
    queue = asyncio.Queue()
    _whisper_log_queues[job_id] = queue

    conn = get_db()
    conn.execute(
        "UPDATE whisper_jobs SET status='running', started_at=? WHERE id=?",
        (now_iso(), job_id)
    )
    conn.commit()
    conn.close()

    adapter_path = WHISPER_MODELS_DIR / str(job_id)
    adapter_path.mkdir(parents=True, exist_ok=True)

    # Manifest lesen
    dataset_dir = WHISPER_AUDIO_DIR / str(req.dataset_id)
    manifest_path = dataset_dir / "manifest.jsonl"

    if not manifest_path.exists():
        _finish_whisper_job(job_id, "failed", f"Manifest nicht gefunden: {manifest_path}")
        return

    await queue.put({"type": "info", "msg": f"🎙️ Groot Whisper: Starting fine-tuning job #{job_id}"})
    await queue.put({"type": "info", "msg": f"📦 Model: {req.base_model}"})

    # Training-Script als Python-Subprocess
    train_script = _build_training_script(req, manifest_path, adapter_path)
    script_path = Path(f"/tmp/whisper_train_{job_id}.py")
    script_path.write_text(train_script)

    python = sys.executable
    try:
        process = await asyncio.create_subprocess_exec(
            python, str(script_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        _whisper_processes[job_id] = process

        final_wer = None
        log_path = Path(f"/tmp/groot-whisper-{job_id}.log")

        with open(log_path, "w") as log_file:
            while True:
                raw = await process.stdout.readline()
                if not raw:
                    break
                line = raw.decode(errors="replace").rstrip()
                if line:
                    await queue.put({"type": "log", "msg": line})
                    log_file.write(line + "\n")
                    log_file.flush()
                    wer_match = re.search(r"WER[:\s=]+([0-9.]+)%?", line, re.IGNORECASE)
                    if wer_match:
                        try:
                            final_wer = float(wer_match.group(1))
                        except ValueError:
                            pass

        await process.wait()
        if process.returncode == 0:
            await queue.put({"type": "success", "msg": f"✅ Whisper Training abgeschlossen! WER: {final_wer}%"})
            _finish_whisper_job(job_id, "completed", adapter_path=str(adapter_path), wer=final_wer)
        else:
            err = f"Process exited with code {process.returncode}"
            _finish_whisper_job(job_id, "failed", error=err)

    except Exception as e:
        _finish_whisper_job(job_id, "failed", error=str(e))
    finally:
        await queue.put({"type": "done", "msg": "__STREAM_END__"})


def _finish_whisper_job(job_id: int, status: str, error: str = None,
                         adapter_path: str = None, wer: float = None):
    conn = get_db()
    conn.execute(
        "UPDATE whisper_jobs SET status=?, finished_at=?, error_message=?, adapter_path=?, final_wer=? WHERE id=?",
        (status, now_iso(), error, adapter_path, wer, job_id)
    )
    conn.commit()
    conn.close()


def _build_training_script(req: WhisperTrainRequest, manifest_path: Path, output_dir: Path) -> str:
    """Generiert das HuggingFace Whisper Fine-Tuning Script."""
    return f'''#!/usr/bin/env python3
"""Auto-generated Whisper Fine-Tuning Script — Job #{0}"""
import json, os, sys
import torch
import numpy as np
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Dict, List, Union

from transformers import (
    WhisperProcessor,
    WhisperForConditionalGeneration,
    Seq2SeqTrainer,
    Seq2SeqTrainingArguments,
)
from datasets import Dataset, Audio
import evaluate

print("🎙️ Groot Whisper Fine-Tuning", flush=True)
print(f"Model: {req.base_model}", flush=True)

# ── Daten laden ──────────────────────────────────────────────────────────────
manifest = []
with open("{manifest_path}") as f:
    for line in f:
        manifest.append(json.loads(line))

print(f"📂 Dataset: {{len(manifest)}} Audio-Clips", flush=True)

# HuggingFace Dataset
dataset = Dataset.from_list([
    {{"audio": item["audio"], "sentence": item["text"]}}
    for item in manifest
]).cast_column("audio", Audio(sampling_rate=16000))

# 90/10 Split
split = dataset.train_test_split(test_size=0.1, seed=42)
train_ds = split["train"]
eval_ds = split["test"]

# ── Model + Processor ────────────────────────────────────────────────────────
processor = WhisperProcessor.from_pretrained("{req.base_model}", language="{req.language}", task="transcribe")
model = WhisperForConditionalGeneration.from_pretrained("{req.base_model}")
model.config.forced_decoder_ids = None
model.config.suppress_tokens = []
model.config.use_cache = False

# ── Data Collator ─────────────────────────────────────────────────────────────
@dataclass
class DataCollatorSpeechSeq2SeqWithPadding:
    processor: Any
    decoder_start_token_id: int

    def __call__(self, features):
        input_features = [{{"input_features": f["input_features"]}} for f in features]
        batch = self.processor.feature_extractor.pad(input_features, return_tensors="pt")
        label_features = [{{"input_ids": f["labels"]}} for f in features]
        labels_batch = self.processor.tokenizer.pad(label_features, return_tensors="pt")
        labels = labels_batch["input_ids"].masked_fill(
            labels_batch.attention_mask.ne(1), -100
        )
        if (labels[:, 0] == self.decoder_start_token_id).all().cpu().item():
            labels = labels[:, 1:]
        batch["labels"] = labels
        return batch

def prepare_dataset(batch):
    audio = batch["audio"]
    batch["input_features"] = processor.feature_extractor(
        audio["array"], sampling_rate=audio["sampling_rate"]
    ).input_features[0]
    batch["labels"] = processor.tokenizer(batch["sentence"]).input_ids
    return batch

print("⚙️  Preparing dataset...", flush=True)
train_ds = train_ds.map(prepare_dataset, remove_columns=train_ds.column_names)
eval_ds = eval_ds.map(prepare_dataset, remove_columns=eval_ds.column_names)

data_collator = DataCollatorSpeechSeq2SeqWithPadding(
    processor=processor,
    decoder_start_token_id=model.config.decoder_start_token_id,
)

# ── Metriken ─────────────────────────────────────────────────────────────────
metric = evaluate.load("wer")

def compute_metrics(pred):
    pred_ids = pred.predictions
    label_ids = pred.label_ids
    label_ids[label_ids == -100] = processor.tokenizer.pad_token_id
    pred_str = processor.tokenizer.batch_decode(pred_ids, skip_special_tokens=True)
    label_str = processor.tokenizer.batch_decode(label_ids, skip_special_tokens=True)
    wer = 100 * metric.compute(predictions=pred_str, references=label_str)
    print(f"WER: {{wer:.2f}}%", flush=True)
    return {{"wer": wer}}

# ── Training ──────────────────────────────────────────────────────────────────
training_args = Seq2SeqTrainingArguments(
    output_dir="{output_dir}",
    per_device_train_batch_size={req.batch_size},
    gradient_accumulation_steps=2,
    learning_rate={req.learning_rate},
    warmup_steps=50,
    max_steps={req.max_steps},
    fp16=False,
    evaluation_strategy="steps",
    per_device_eval_batch_size={req.batch_size},
    predict_with_generate=True,
    generation_max_length=225,
    save_steps=200,
    eval_steps=200,
    logging_steps=25,
    report_to=["none"],
    load_best_model_at_end=True,
    metric_for_best_model="wer",
    greater_is_better=False,
    push_to_hub=False,
)

trainer = Seq2SeqTrainer(
    args=training_args,
    model=model,
    train_dataset=train_ds,
    eval_dataset=eval_ds,
    data_collator=data_collator,
    compute_metrics=compute_metrics,
    tokenizer=processor.feature_extractor,
)

print(f"🚀 Training startet: {{len(train_ds)}} Train / {{len(eval_ds)}} Eval", flush=True)
trainer.train()

# Modell speichern
model.save_pretrained("{output_dir}")
processor.save_pretrained("{output_dir}")
print(f"✅ Modell gespeichert: {output_dir}", flush=True)
'''


# ── Clip Review Queue ─────────────────────────────────────────────────────────

@router.get("/datasets/{dataset_id}/clips/stats")
async def clip_stats(dataset_id: int):
    """Zählt Clips nach Status."""
    conn = get_db()
    rows = conn.execute(
        "SELECT status, COUNT(*) as cnt FROM whisper_clips WHERE dataset_id=? GROUP BY status",
        (dataset_id,)
    ).fetchall()
    conn.close()
    stats = {r[0]: r[1] for r in rows}
    total = sum(stats.values())
    return {
        "total": total,
        "pending": stats.get("pending", 0),
        "approved": stats.get("approved", 0),
        "rejected": stats.get("rejected", 0),
        "progress": round(stats.get("approved", 0) / total * 100) if total else 0,
    }



@router.patch("/datasets/{dataset_id}/clips/{clip_id}/status")
async def set_clip_status(dataset_id: int, clip_id: int, body: dict):
    """Setzt Status eines Clips: pending / approved / rejected."""
    new_status = body.get("status")
    if new_status not in ("pending", "approved", "rejected"):
        raise HTTPException(400, "status must be pending, approved, or rejected")
    conn = get_db()
    conn.execute(
        "UPDATE whisper_clips SET status=? WHERE id=? AND dataset_id=?",
        (new_status, clip_id, dataset_id)
    )
    conn.commit()
    conn.close()
    return {"id": clip_id, "status": new_status}

@router.post("/datasets/{dataset_id}/clips/{clip_id}/regenerate")
async def regenerate_clip(dataset_id: int, clip_id: int, body: dict = {}):
    """Generiert einen einzelnen Clip neu (optional andere Voice-ID)."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM whisper_clips WHERE id=? AND dataset_id=?", (clip_id, dataset_id)
    ).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Clip not found")
    d = dict_from_row(row)

    voice_id = body.get("voice_id") or d.get("voice_id") or "rruSEtlKAwIe1cvEmP9J"
    conn.execute(
        "UPDATE whisper_clips SET status='pending', voice_id=? WHERE id=?",
        (voice_id, clip_id)
    )
    conn.commit(); conn.close()

    # Async regenerieren
    asyncio.create_task(_regenerate_single_clip(clip_id, dataset_id, d, voice_id))
    return {"id": clip_id, "status": "regenerating"}

async def _regenerate_single_clip(clip_id: int, dataset_id: int, clip: dict, voice_id: str):
    """Regeneriert einen einzelnen Clip via ElevenLabs."""
    import aiohttp
    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        return

    text = clip["sentence"]
    mp3_path = Path(clip["audio_path"])
    wav_path = Path(clip["wav_path"])

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json={"text": text, "model_id": "eleven_multilingual_v2",
                      "voice_settings": {"stability": 0.7, "similarity_boost": 0.8}},
                timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status == 200:
                    mp3_path.write_bytes(await resp.read())
                    # → WAV konvertieren
                    subprocess.run([
                        "ffmpeg", "-i", str(mp3_path),
                        "-ar", "16000", "-ac", "1", "-f", "wav",
                        str(wav_path), "-y", "-loglevel", "quiet"
                    ], capture_output=True)

        conn = get_db()
        conn.execute(
            "UPDATE whisper_clips SET status='pending', regenerated_at=?, voice_id=? WHERE id=?",
            (now_iso(), voice_id, clip_id)
        )
        conn.commit(); conn.close()
    except Exception as e:
        print(f"Clip regeneration failed: {e}")

@router.post("/datasets/{dataset_id}/clips/approve-all")
async def approve_all(dataset_id: int):
    """Alle pending Clips auf approved setzen."""
    conn = get_db()
    conn.execute(
        "UPDATE whisper_clips SET status='approved' WHERE dataset_id=? AND status='pending'",
        (dataset_id,)
    )
    affected = conn.execute(
        "SELECT COUNT(*) FROM whisper_clips WHERE dataset_id=? AND status='approved'",
        (dataset_id,)
    ).fetchone()[0]
    conn.commit(); conn.close()
    return {"approved": affected}

@router.post("/datasets/{dataset_id}/clips/import-manifest")
async def import_manifest(dataset_id: int, body: dict = {}):
    """Importiert Clips aus manifest.jsonl in die DB (idempotent)."""
    dataset_dir = WHISPER_AUDIO_DIR / str(dataset_id)
    manifest_path = dataset_dir / "manifest.jsonl"
    if not manifest_path.exists():
        raise HTTPException(404, "manifest.jsonl not found")

    conn = get_db()
    existing = conn.execute(
        "SELECT COUNT(*) FROM whisper_clips WHERE dataset_id=?", (dataset_id,)
    ).fetchone()[0]
    if existing > 0:
        conn.close()
        return {"imported": 0, "existing": existing, "msg": "Already imported"}

    clips = []
    with open(manifest_path) as f:
        for i, line in enumerate(f):
            item = json.loads(line)
            wav = item["audio"]
            mp3 = wav.replace(".wav", ".mp3")
            clips.append((dataset_id, i, item["term"], item["text"], mp3, wav, "pending",
                          body.get("voice_id", "rruSEtlKAwIe1cvEmP9J")))

    conn.executemany(
        "INSERT INTO whisper_clips (dataset_id, clip_index, term, sentence, audio_path, wav_path, status, voice_id) VALUES (?,?,?,?,?,?,?,?)",
        clips
    )
    conn.commit(); conn.close()
    return {"imported": len(clips)}


# ── Audio Review Queue ────────────────────────────────────────────────────────

def ensure_clips_table():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS whisper_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dataset_id INTEGER NOT NULL,
            clip_index INTEGER,
            term TEXT,
            sentence TEXT,
            audio_path TEXT,
            wav_path TEXT,
            status TEXT DEFAULT 'pending',
            voice_id TEXT DEFAULT 'rruSEtlKAwIe1cvEmP9J',
            created_at TEXT,
            regenerated_at TEXT
        )
    """)
    conn.commit()
    conn.close()

ensure_clips_table()


@router.get("/datasets/{dataset_id}/clips")
async def list_clips(dataset_id: int, status: str = None):
    conn = get_db()
    if status:
        rows = conn.execute(
            "SELECT * FROM whisper_clips WHERE dataset_id=? AND status=? ORDER BY clip_index",
            (dataset_id, status)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM whisper_clips WHERE dataset_id=? ORDER BY clip_index",
            (dataset_id,)
        ).fetchall()
    conn.close()
    clips = [dict_from_row(r) for r in rows]
    # Stats
    all_rows = get_db().execute(
        "SELECT status, COUNT(*) as n FROM whisper_clips WHERE dataset_id=? GROUP BY status",
        (dataset_id,)
    ).fetchall()
    get_db().close()
    stats = {r[0]: r[1] for r in all_rows}
    return {"clips": clips, "stats": stats}


@router.get("/datasets/{dataset_id}/clips/{clip_id}/audio")
async def serve_clip_audio(dataset_id: int, clip_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM whisper_clips WHERE id=? AND dataset_id=?",
        (clip_id, dataset_id)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Clip not found")
    clip = dict_from_row(row)
    # WAV bevorzugen (enthält ggf. eigene Aufnahme), Fallback MP3
    wav = clip.get("wav_path")
    mp3 = clip.get("audio_path")
    if wav and Path(wav).exists() and Path(wav).stat().st_size > 100:
        return FileResponse(wav, media_type="audio/wav",
                            headers={"Cache-Control": "no-store"})
    elif mp3 and Path(mp3).exists():
        return FileResponse(mp3, media_type="audio/mpeg",
                            headers={"Cache-Control": "no-store"})
    raise HTTPException(404, "Audio file not found")


@router.patch("/datasets/{dataset_id}/clips/{clip_id}")
async def update_clip_status(dataset_id: int, clip_id: int, body: dict):
    status = body.get("status")
    if status not in ("pending", "approved", "rejected"):
        raise HTTPException(400, "status must be pending|approved|rejected")
    conn = get_db()
    conn.execute(
        "UPDATE whisper_clips SET status=? WHERE id=? AND dataset_id=?",
        (status, clip_id, dataset_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "status": status}


@router.post("/datasets/{dataset_id}/clips/{clip_id}/regenerate")
async def regenerate_clip(dataset_id: int, clip_id: int, body: dict = {}):
    """Clip via ElevenLabs neu generieren — optional andere Voice."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM whisper_clips WHERE id=? AND dataset_id=?",
        (clip_id, dataset_id)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Clip not found")
    clip = dict_from_row(row)

    voice_id = body.get("voice_id") or clip["voice_id"] or "rruSEtlKAwIe1cvEmP9J"
    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        raise HTTPException(500, "ELEVENLABS_API_KEY not set")

    import httpx
    text = clip["sentence"]
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json={"text": text, "model_id": "eleven_multilingual_v2",
                      "voice_settings": {"stability": 0.65, "similarity_boost": 0.8}}
            )
            if resp.status_code != 200:
                raise HTTPException(502, f"ElevenLabs error: {resp.status_code}")
            audio_data = resp.content
    except httpx.TimeoutException:
        raise HTTPException(504, "ElevenLabs timeout")

    # Überschreibe bestehende Datei
    mp3_path = Path(clip["audio_path"])
    mp3_path.write_bytes(audio_data)

    # WAV neu konvertieren
    wav_path = Path(clip["wav_path"]) if clip.get("wav_path") else mp3_path.with_suffix(".wav")
    subprocess.run([
        "ffmpeg", "-i", str(mp3_path),
        "-ar", "16000", "-ac", "1", "-f", "wav", str(wav_path),
        "-y", "-loglevel", "quiet"
    ], capture_output=True)

    conn = get_db()
    conn.execute(
        "UPDATE whisper_clips SET status='pending', voice_id=?, regenerated_at=? WHERE id=?",
        (voice_id, now_iso(), clip_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "voice_id": voice_id}


@router.post("/datasets/{dataset_id}/clips/{clip_id}/upload")
async def upload_recorded_clip(dataset_id: int, clip_id: int, file: UploadFile = File(...)):
    """Eigene Aufnahme hochladen (Browser-Mikrofon)."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM whisper_clips WHERE id=? AND dataset_id=?",
        (clip_id, dataset_id)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Clip not found")
    clip = dict_from_row(row)

    raw_path = Path(clip["wav_path"]).with_suffix(".recorded.webm")
    raw_path.write_bytes(await file.read())

    # WebM → WAV 16kHz mono (Whisper-Format)
    wav_path = Path(clip["wav_path"])
    result = subprocess.run([
        "ffmpeg", "-i", str(raw_path),
        "-ar", "16000", "-ac", "1", "-f", "wav", str(wav_path),
        "-y", "-loglevel", "quiet"
    ], capture_output=True)

    raw_path.unlink(missing_ok=True)

    if result.returncode != 0:
        raise HTTPException(500, f"ffmpeg conversion failed: {result.stderr.decode()}")

    if not wav_path.exists() or wav_path.stat().st_size < 1000:
        raise HTTPException(500, "Converted WAV file is empty or missing")

    # Status: pending (nicht approved) — User soll erst anhören!
    conn = get_db()
    conn.execute(
        "UPDATE whisper_clips SET status='pending', voice_id='user_recording', regenerated_at=? WHERE id=?",
        (now_iso(), clip_id)
    )
    conn.commit()
    conn.close()
    ts = now_iso()
    conn = get_db()
    conn.execute(
        "UPDATE whisper_clips SET regenerated_at=? WHERE id=?",
        (ts, clip_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "source": "user_recording", "wav_size": wav_path.stat().st_size, "saved_at": ts}


@router.get("/datasets/{dataset_id}/stats")
async def dataset_stats(dataset_id: int):
    conn = get_db()
    rows = conn.execute(
        "SELECT status, COUNT(*) as n FROM whisper_clips WHERE dataset_id=? GROUP BY status",
        (dataset_id,)
    ).fetchall()
    conn.close()
    stats = {r[0]: r[1] for r in rows}
    total = sum(stats.values())
    return {
        "total": total,
        "approved": stats.get("approved", 0),
        "rejected": stats.get("rejected", 0),
        "pending": stats.get("pending", 0),
        "progress": round(stats.get("approved", 0) / total * 100) if total else 0
    }
