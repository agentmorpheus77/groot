"""
Groot – MLX-LM Training Pipeline
Wraps mlx_lm.lora and mlx_lm.fuse as subprocesses.
Streams stdout/stderr to a log queue for SSE delivery.
"""
import asyncio
import json
import os
import re
import sys
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional

# Base paths
DATA_DIR = Path(__file__).parent.parent / "data"
DATASETS_DIR = DATA_DIR / "datasets"
ADAPTERS_DIR = DATA_DIR / "adapters"
MODELS_DIR = DATA_DIR / "models"

# Ensure dirs exist
for d in [DATASETS_DIR, ADAPTERS_DIR, MODELS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# In-memory log buffer per job_id
_log_queues: dict[int, asyncio.Queue] = {}
_job_processes: dict[int, subprocess.Popen] = {}


def get_log_queue(job_id: int) -> asyncio.Queue:
    if job_id not in _log_queues:
        _log_queues[job_id] = asyncio.Queue()
    return _log_queues[job_id]


def clear_log_queue(job_id: int):
    _log_queues.pop(job_id, None)


async def convert_dataset_to_mlx(file_path: Path, out_dir: Path) -> int:
    """
    Reads JSONL/CSV, normalizes to MLX-LM format:
    {"prompt": "...", "completion": "..."}
    and writes train.jsonl, valid.jsonl (90/10 split).
    Returns number of rows.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []

    suffix = file_path.suffix.lower()
    if suffix in (".jsonl", ".json"):
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    # Normalize field names
                    prompt = obj.get("prompt") or obj.get("question") or obj.get("input") or ""
                    completion = obj.get("completion") or obj.get("answer") or obj.get("output") or ""
                    if prompt and completion:
                        rows.append({"prompt": prompt, "completion": completion})
                except json.JSONDecodeError:
                    continue
    elif suffix == ".csv":
        import csv
        with open(file_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for obj in reader:
                prompt = obj.get("prompt") or obj.get("question") or obj.get("input") or ""
                completion = obj.get("completion") or obj.get("answer") or obj.get("output") or ""
                if prompt and completion:
                    rows.append({"prompt": prompt, "completion": completion})

    if not rows:
        raise ValueError("No valid rows found in dataset. Expected fields: prompt/completion or question/answer")

    # 90/10 split
    split = max(1, int(len(rows) * 0.9))
    train_rows = rows[:split]
    valid_rows = rows[split:] or rows[:1]  # at least 1 valid row

    SYSTEM_PROMPT = "Du bist ein Wissensdatenbank-Assistent. Gib alle relevanten Fakten zu der Frage aus."
    CHARS_PER_TOKEN = 3.5
    # Reserve tokens for: system prompt + user prompt + all template tokens (~60 overhead)
    TEMPLATE_OVERHEAD_CHARS = int(60 * CHARS_PER_TOKEN)

    def build_text(prompt: str, completion: str) -> str:
        """Qwen3/DeepSeek chat template — MUST match mlx_lm.generate inference format."""
        return (
            f"<|im_start|>system\n{SYSTEM_PROMPT}\n<|im_end|>\n"
            f"<|im_start|>user\n{prompt}\n<|im_end|>\n"
            f"<|im_start|>assistant\n{completion}<|im_end|>"
        )

    def split_completion(prompt: str, completion: str, max_tokens: int = 480) -> list[str]:
        """
        Split long completions into chunks that fit within max_tokens.
        Splits at paragraph → sentence → hard character boundary.
        Returns list of completion chunks, each paired with the original prompt.
        """
        prompt_tokens = (len(prompt) + TEMPLATE_OVERHEAD_CHARS) / CHARS_PER_TOKEN
        budget_chars = int((max_tokens - prompt_tokens) * CHARS_PER_TOKEN)

        if len(completion) <= budget_chars:
            return [completion]

        chunks = []
        remaining = completion

        while remaining:
            if len(remaining) <= budget_chars:
                chunks.append(remaining.strip())
                break

            # Try to split at paragraph boundary
            split_at = remaining[:budget_chars].rfind("\n\n")
            if split_at < budget_chars * 0.5:
                # Try newline
                split_at = remaining[:budget_chars].rfind("\n")
            if split_at < budget_chars * 0.5:
                # Try sentence boundary
                for sep in [". ", "! ", "? ", "; "]:
                    pos = remaining[:budget_chars].rfind(sep)
                    if pos > budget_chars * 0.5:
                        split_at = pos + len(sep) - 1
                        break
            if split_at < budget_chars * 0.3:
                # Hard split
                split_at = budget_chars

            chunk = remaining[:split_at].strip()
            if chunk:
                chunks.append(chunk)
            remaining = remaining[split_at:].strip()

        return chunks if chunks else [completion[:budget_chars]]

    def write_jsonl(path: Path, data: list):
        with open(path, "w", encoding="utf-8") as f:
            written = 0
            split_count = 0
            for row in data:
                chunks = split_completion(row["prompt"], row["completion"])
                for i, chunk in enumerate(chunks):
                    text = build_text(row["prompt"], chunk)
                    f.write(json.dumps({"text": text}) + "\n")
                    written += 1
                if len(chunks) > 1:
                    split_count += 1
            return written, split_count

    train_written, train_splits = write_jsonl(out_dir / "train.jsonl", train_rows)
    valid_written, valid_splits = write_jsonl(out_dir / "valid.jsonl", valid_rows)
    # Log split stats to a metadata file
    with open(out_dir / "split_stats.json", "w") as f:
        json.dump({
            "original_rows": len(rows),
            "train_written": train_written,
            "train_splits": train_splits,
            "valid_written": valid_written,
            "valid_splits": valid_splits,
        }, f, indent=2)

    return len(rows)


async def run_training_job(
    job_id: int,
    dataset_id: int,
    base_model: str,
    epochs: int,
    learning_rate: float,
    max_seq_length: int,
    batch_size: int,
    iters: int,
    on_status_change,
    resume_adapter_path: str = None,
):
    """
    Runs mlx_lm.lora training as a subprocess.
    Streams output to log queue.
    Calls on_status_change(status, error=None, loss=None) when done.
    """
    queue = get_log_queue(job_id)

    dataset_dir = DATASETS_DIR / str(dataset_id)
    adapter_path = ADAPTERS_DIR / str(job_id)
    adapter_path.mkdir(parents=True, exist_ok=True)

    # Build mlx_lm.lora command
    python = sys.executable
    cmd = [
        python, "-m", "mlx_lm.lora",
        "--model", base_model,
        "--train",
        "--data", str(dataset_dir),
        "--iters", str(iters),
        "--batch-size", str(batch_size),
        "--num-layers", "8",           # Weniger LoRA-Layers → weniger RAM
        "--val-batches", "25",         # Max 25 Validation-Batches → kein Metal OOM
        "--save-every", str(max(10, iters // 10)),
        "--adapter-path", str(adapter_path),
    ]

    if resume_adapter_path:
        cmd += ["--resume-adapter-file", resume_adapter_path]

    cmd += [
        "--learning-rate", str(learning_rate),
        "--max-seq-length", str(max_seq_length),
        "--grad-checkpoint",           # 30-40% weniger Peak-RAM
        "--grad-accumulation-steps", "2",  # Effektiver Batch = batch_size × 2
    ]

    await queue.put({"type": "info", "msg": f"🌱 Groot: Starting training job #{job_id}"})
    await queue.put({"type": "info", "msg": f"📦 Model: {base_model}"})
    await queue.put({"type": "info", "msg": f"🔧 Config: iters={iters}, batch={batch_size}, lr={learning_rate}"})
    await queue.put({"type": "info", "msg": f"📂 Adapter path: {adapter_path}"})
    if resume_adapter_path:
        await queue.put({"type": "info", "msg": f"🔄 Resuming from: {resume_adapter_path}"})
    await queue.put({"type": "cmd", "msg": " ".join(cmd)})

    try:
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        # Use asyncio subprocess to avoid blocking the event loop
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
        _job_processes[job_id] = process

        final_loss = None

        # Also write to log file for SSE fallback (Cloudflare tunnel polling)
        log_file_path = Path(f"/tmp/groot-training-{job_id}.log")
        log_file_path.parent.mkdir(parents=True, exist_ok=True)

        # Read output line by line (non-blocking)
        with open(log_file_path, "w") as log_file:
            while True:
                raw = await process.stdout.readline()
                if not raw:
                    break
                line = raw.decode(errors="replace").rstrip()
                if line:
                    await queue.put({"type": "log", "msg": line})
                    log_file.write(line + "\n")
                    log_file.flush()  # Sofort schreiben damit Polling es lesen kann
                    loss_match = re.search(r"[Ll]oss[:\s=]+([0-9.]+)", line)
                    if loss_match:
                        try:
                            final_loss = float(loss_match.group(1))
                        except ValueError:
                            pass

        await process.wait()
        _job_processes.pop(job_id, None)

        if process.returncode == 0:
            await queue.put({"type": "success", "msg": f"✅ Training completed! Final loss: {final_loss}"})
            await on_status_change("completed", loss=final_loss, adapter_path=str(adapter_path))
        else:
            error = f"Process exited with code {process.returncode}"
            await queue.put({"type": "error", "msg": f"❌ Training failed: {error}"})
            await on_status_change("failed", error=error)

    except Exception as e:
        await queue.put({"type": "error", "msg": f"❌ Exception: {str(e)}"})
        await on_status_change("failed", error=str(e))
    finally:
        await queue.put({"type": "done", "msg": "__STREAM_END__"})


async def run_fuse_model(job_id: int, base_model: str, adapter_path: str) -> str:
    """
    Fuses adapter weights into base model using mlx_lm.fuse.
    Returns path to fused model.
    """
    queue = get_log_queue(job_id)
    fused_path = MODELS_DIR / str(job_id)
    fused_path.mkdir(parents=True, exist_ok=True)

    python = sys.executable
    cmd = [
        python, "-m", "mlx_lm.fuse",
        "--model", base_model,
        "--adapter-path", adapter_path,
        "--save-path", str(fused_path),
    ]

    await queue.put({"type": "info", "msg": f"🔀 Fusing adapter into base model..."})
    await queue.put({"type": "cmd", "msg": " ".join(cmd)})

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        for line in iter(process.stdout.readline, ""):
            line = line.rstrip()
            if line:
                await queue.put({"type": "log", "msg": line})

        process.wait()

        if process.returncode == 0:
            await queue.put({"type": "success", "msg": f"✅ Model fused! Saved to: {fused_path}"})
            return str(fused_path)
        else:
            raise RuntimeError(f"Fuse failed with code {process.returncode}")

    except Exception as e:
        await queue.put({"type": "error", "msg": f"❌ Fuse failed: {str(e)}"})
        raise


def _clean_mlx_output(raw: str, prompt: str) -> str:
    """
    Strip all mlx_lm noise from inference output:
    - Deprecation warnings
    - ========== separators
    - Token stats (Prompt: X tokens, Generation: ...)
    - Peak memory lines
    - Echo of the input prompt
    Returns only the clean generated text.
    """
    lines = raw.split("\n")
    clean = []
    skip_patterns = [
        "Calling `python",
        "directly is deprecated",
        "Use `mlx_lm",
        "==========",
        "Prompt:",
        "Generation:",
        "Peak mem",
        "tokens-per-sec",
        "tokens, ",
        "found in sys.modules",
        "unpredictable behaviour",
        "RuntimeWarning",
        "Fetching",
        "frozen runpy",
        "it/s]",
        "0%|",
        "100%|",
        "Unrecognized keys in",
        "rope_parameters",
        "rope_type",
        "attn_factor",
        "UserWarning",
        "warnings.warn",
    ]
    for line in lines:
        if any(p in line for p in skip_patterns):
            continue
        clean.append(line)
    result = "\n".join(clean).strip()
    # Remove echo of prompt if present
    if prompt in result:
        result = result.replace(prompt, "").strip()
    # Remove EOS tokens
    result = result.replace("</s>", "").replace("<s>", "").strip()
    # Strip Qwen3 thinking blocks <think>...</think> (auch ungeschlossen)
    import re
    result = re.sub(r"<think>.*?</think>", "", result, flags=re.DOTALL)
    result = re.sub(r"<think>.*", "", result, flags=re.DOTALL)  # ungeschlossen
    # Strip remaining chat template tokens
    for token in ["<|im_end|>", "<|im_start|>", "<|endoftext|>"]:
        result = result.replace(token, "")
    return result.strip()


async def run_inference(model_path: str, prompt: str, max_tokens: int = 256, system_prompt: str = "Du bist ein hilfreicher Assistent. Antworte präzise und vollständig auf Deutsch.") -> str:
    """
    Run inference against a fused model using mlx_lm.generate.
    """
    python = sys.executable
    cmd = [
        python, "-m", "mlx_lm.generate",
        "--model", model_path,
        "--system-prompt", system_prompt,
        "--prompt", prompt,
        "--max-tokens", str(max_tokens),
        "--temp", "0.7",
        "--top-p", "0.9",
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        output = result.stdout + result.stderr
        return _clean_mlx_output(output, prompt) or "⚠️ No response generated"
    except subprocess.TimeoutExpired:
        return "⚠️ Inference timed out after 120s"
    except Exception as e:
        return f"❌ Inference error: {str(e)}"


async def run_adapter_inference(base_model: str, adapter_path: str, prompt: str, max_tokens: int = 512, system_prompt: str = "Du bist ein hilfreicher Assistent. Antworte präzise und vollständig auf Deutsch.") -> str:
    """
    2-Schritt Pipeline:
    1. Adapter holt Wissen (KG-Format, DeepSeek R1 mit <think>)
    2. Qwen3-1.7B reformuliert sauber auf Deutsch (schnell, kein Reasoning)
    Für einfache Grüße/Smalltalk: direkt Qwen3-1.7B ohne Adapter (schneller).
    """
    import re
    python = sys.executable

    # ── Shortcut: Einfache Grüße ohne KG-Abfrage ──────────────────────────
    greetings = ["hallo", "hi", "hey", "guten tag", "guten morgen", "guten abend", "servus", "moin"]
    if prompt.strip().lower().rstrip("!?.") in greetings:
        cmd_greeting = [
            python, "-m", "mlx_lm.generate",
            "--model", "mlx-community/Qwen3-4B-Instruct-2507-4bit",
            "--system-prompt", system_prompt,
            "--prompt", prompt,
            "--max-tokens", "80",
            "--temp", "0.8",
        ]
        try:
            r = subprocess.run(cmd_greeting, capture_output=True, text=True, timeout=30)
            cleaned = _clean_mlx_output(r.stdout + r.stderr, prompt)
            cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL)
            cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL)
            for stop in ["<|im_end|>", "<|im_start|>", "</s>", "<|endoftext|>"]:
                if stop in cleaned:
                    cleaned = cleaned[:cleaned.index(stop)]
            cleaned = cleaned.lstrip("! ").strip()
            return cleaned or "Hallo! Willkommen bei LUTZ-JESCO. Wie kann ich Ihnen helfen?"
        except Exception:
            return "Hallo! Willkommen bei LUTZ-JESCO. Wie kann ich Ihnen helfen?"

    # ── Schritt 1: Wissen mit Adapter abrufen ──────────────────────────────
    cmd_knowledge = [
        python, "-m", "mlx_lm.generate",
        "--model", base_model,
        "--adapter-path", adapter_path,
        "--system-prompt", "Du bist ein Wissensdatenbank-Assistent. Gib alle relevanten Fakten zu der Frage aus.",
        "--prompt", prompt,
        "--max-tokens", str(max_tokens),
        "--temp", "0.1",
    ]

    try:
        result1 = subprocess.run(cmd_knowledge, capture_output=True, text=True, timeout=180)
        raw = result1.stdout + result1.stderr
        # Clean mlx noise
        raw_knowledge = _clean_mlx_output(raw, prompt)
        # Strip thinking blocks
        raw_knowledge = re.sub(r"<think>.*?</think>", "", raw_knowledge, flags=re.DOTALL)
        raw_knowledge = re.sub(r"<think>.*", "", raw_knowledge, flags=re.DOTALL)
        for stop in ["<|im_end|>", "<|im_start|>", "</s>", "<|endoftext|>"]:
            if stop in raw_knowledge:
                raw_knowledge = raw_knowledge[:raw_knowledge.index(stop)]
        raw_knowledge = raw_knowledge.strip()
        if not raw_knowledge:
            raw_knowledge = "Keine spezifischen Informationen in der Wissensdatenbank gefunden."
    except subprocess.TimeoutExpired:
        raw_knowledge = "Wissensbankabfrage hat zu lange gedauert."
    except Exception as e:
        raw_knowledge = f"Fehler bei Wissensbankabfrage: {str(e)}"

    # ── Schritt 2: Qwen3-4B reformuliert (schnell, kein <think>) ────────
    # Gate: nur ablehnen wenn explizit "keine Informationen" ODER leer/sehr kurz
    # NICHT schon bei "keine" irgendwo im Text ablehnen (kommt in echten Antworten vor!)
    no_knowledge_phrases = [
        "keine spezifischen informationen",
        "keine informationen",
        "wissensbankabfrage hat zu lange",
        "fehler bei wissensbankabfrage",
        "no response generated",
    ]
    has_knowledge = (
        bool(raw_knowledge) and
        len(raw_knowledge) > 30 and
        not any(phrase in raw_knowledge.lower() for phrase in no_knowledge_phrases)
    )

    reformat_prompt = (
        f"Nutzerfrage: {prompt}\n\n"
        f"{'INTERNE PRODUKTDATEN (NUR DIESE VERWENDEN):' if has_knowledge else 'STATUS: Keine spezifischen Produktdaten verfügbar.'}\n"
        f"{raw_knowledge if has_knowledge else ''}\n\n"
        f"{'Schreibe eine klare, direkte Antwort auf Deutsch NUR basierend auf den obigen Produktdaten. Füge KEIN eigenes Wissen oder Vermutungen hinzu. Wenn die Daten unvollständig sind, sage genau das.' if has_knowledge else 'Teile dem Nutzer freundlich mit, dass du zu diesem Thema keine spezifischen LUTZ-JESCO Daten hast, und empfehle den Kundenservice.'}"
    )

    cmd_reformat = [
        python, "-m", "mlx_lm.generate",
        "--model", "mlx-community/Qwen3-4B-Instruct-2507-4bit",
        "--system-prompt", system_prompt,
        "--prompt", reformat_prompt,
        "--max-tokens", "300",
        "--temp", "0.7",
        "--top-p", "0.9",
    ]

    try:
        result2 = subprocess.run(cmd_reformat, capture_output=True, text=True, timeout=60)
        cleaned = _clean_mlx_output(result2.stdout + result2.stderr, reformat_prompt)
        cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL)
        cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL)
        for stop in ["<|im_end|>", "<|im_start|>", "</s>", "<|endoftext|>"]:
            if stop in cleaned:
                cleaned = cleaned[:cleaned.index(stop)]
        cleaned = cleaned.lstrip("! ").strip()
        return cleaned or "Entschuldigung, ich konnte keine passende Antwort generieren."
    except subprocess.TimeoutExpired:
        return "⚠️ Antwortgenerierung hat zu lange gedauert."
    except Exception as e:
        return f"❌ Fehler: {str(e)}"
