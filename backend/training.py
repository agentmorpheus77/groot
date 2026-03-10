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

    def write_jsonl(path: Path, data: list):
        with open(path, "w", encoding="utf-8") as f:
            for row in data:
                # MLX-LM expects {"text": "..."} with prompt+completion as single text
                text = f"<s>[INST] {row['prompt']} [/INST] {row['completion']} </s>"
                f.write(json.dumps({"text": text}) + "\n")

    write_jsonl(out_dir / "train.jsonl", train_rows)
    write_jsonl(out_dir / "valid.jsonl", valid_rows)

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
        "--num-layers", "16",
        "--save-every", str(max(10, iters // 10)),
        "--adapter-path", str(adapter_path),
    ]

    if resume_adapter_path:
        cmd += ["--resume-adapter-file", resume_adapter_path]

    cmd += [
        "--learning-rate", str(learning_rate),
        "--max-seq-length", str(max_seq_length),
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

        # Read output line by line (non-blocking)
        while True:
            raw = await process.stdout.readline()
            if not raw:
                break
            line = raw.decode(errors="replace").rstrip()
            if line:
                await queue.put({"type": "log", "msg": line})
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
    return result


async def run_inference(model_path: str, prompt: str, max_tokens: int = 256) -> str:
    """
    Run inference against a fused model using mlx_lm.generate.
    """
    python = sys.executable
    cmd = [
        python, "-m", "mlx_lm.generate",
        "--model", model_path,
        "--prompt", prompt,
        "--max-tokens", str(max_tokens),
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        output = result.stdout + result.stderr
        return _clean_mlx_output(output, prompt) or "⚠️ No response generated"
    except subprocess.TimeoutExpired:
        return "⚠️ Inference timed out after 120s"
    except Exception as e:
        return f"❌ Inference error: {str(e)}"


async def run_adapter_inference(base_model: str, adapter_path: str, prompt: str, max_tokens: int = 512) -> str:
    """
    Run inference with LoRA adapter (without fusing).
    Uses proper chat template formatting for instruction models.
    """
    python = sys.executable

    cmd = [
        python, "-m", "mlx_lm.generate",
        "--model", base_model,
        "--adapter-path", adapter_path,
        "--system-prompt", "Du bist ein hilfreicher Assistent. Antworte präzise und vollständig auf Deutsch.",
        "--prompt", prompt,
        "--max-tokens", str(max_tokens),
        "--temp", "0.7",
        "--top-p", "0.9",
        "--min-p", "0.05",
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        output = result.stdout + result.stderr
        cleaned = _clean_mlx_output(output, prompt)
        # Strip chat template artifacts from response
        for stop in ["<|im_end|>", "<|im_start|>", "</s>"]:
            if stop in cleaned:
                cleaned = cleaned[:cleaned.index(stop)]
        return cleaned.strip() or "⚠️ No response generated"
    except subprocess.TimeoutExpired:
        return "⚠️ Inference timed out after 180s"
    except Exception as e:
        return f"❌ Inference error: {str(e)}"
