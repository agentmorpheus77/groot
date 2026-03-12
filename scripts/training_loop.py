#!/usr/bin/env python3
"""
Groot Autonomous Training Loop
Trainiert → Evaluiert → Bewertet → Iteriert bis Qualitätsziel erreicht.

Usage:
  python3 scripts/training_loop.py --job 18          # Monitor laufenden Job + Auto-Eval
  python3 scripts/training_loop.py --start           # Neuen Job starten + Loop
  python3 scripts/training_loop.py --eval --model 6  # Nur Eval eines fertigen Modells
"""

import argparse
import json
import os
import re
import sys
import time
import subprocess
from datetime import datetime
from pathlib import Path
import requests

API = "http://localhost:8765"
LOG_DIR = Path("/tmp")

# ──────────────────────────────────────────────────────────────────────────────
# Konfiguration
# ──────────────────────────────────────────────────────────────────────────────

# Qualitätsziel: mind. diese Fragen müssen PASS sein
TARGET_PASS_RATE = 0.80       # 80% = 5 von 6 Tests
QUALITY_TARGET_LOSS = 0.75    # Unter diesem Loss gilt Training als "gut"
MAX_ITERATIONS = 3            # Max. Trainings-Runs pro Loop

# Standard-Trainingsparameter
DEFAULT_PARAMS = {
    "dataset_id": 4,  # lutz-training-v2 (mit OOD-Paaren)
    "base_model": "mlx-community/Qwen3-4B-Instruct-2507-4bit",
    "epochs": 3,
    "learning_rate": 0.00005,
    "max_seq_length": 512,
    "batch_size": 1,
    "iters": 20000,
}

# Eval-Testsuite
EVAL_TESTS = [
    {
        "q": "Ab welcher Temperatur ist PVC-U bei Salpetersäure nicht mehr beständig?",
        "keywords_pass": ["80", "80°c", "80 °c"],
        "keywords_fail": ["100 °c", "100°c", "keine"],
        "label": "PVC-U Temperatur (80°C)",
        "critical": True,
    },
    {
        "q": "Ab welchem Gesamtgewicht an Chlorgas greifen die Hazardous Substances Regulations?",
        "keywords_pass": ["100 kg", "100kg"],
        "keywords_fail": ["keine", "leider"],
        "label": "Chlorgas 100 kg Grenzwert",
        "critical": True,
    },
    {
        "q": "Welche Modelle gehören zur Chlorgas-Vakuumregler Serie C 22xx?",
        "keywords_pass": ["c 2210", "c 2213", "c 2214", "c 2216", "c 2217"],
        "keywords_fail": ["c 2218", "c 2219", "c 2220", "c 2225", "c 2230"],
        "label": "C22xx Modelle (keine Halluzination)",
        "critical": True,
    },
    {
        "q": "Was ist CDBrain?",
        "keywords_pass": ["kein", "nicht mein", "außerhalb", "kundenservice", "lutz-jesco"],
        "keywords_fail": ["softwareentwickler", "crm", "datenbank"],
        "label": "Out-of-Domain: CDBrain ablehnen",
        "critical": True,
    },
    {
        "q": "Wie ist das Wetter heute?",
        "keywords_pass": ["nicht mein", "fachgebiet", "außerhalb", "kundenservice", "leider"],
        "keywords_fail": ["grad", "sonnig", "regen", "bewölkt"],
        "label": "Out-of-Domain: Wetter ablehnen",
        "critical": False,
    },
    {
        "q": "Hallo",
        "keywords_pass": ["hallo", "willkommen", "helfen", "lutz-jesco", "assistent"],
        "keywords_fail": ["error", "fehler"],
        "label": "Smalltalk: Begrüßung",
        "critical": False,
    },
]


# ──────────────────────────────────────────────────────────────────────────────
# Hilfsfunktionen
# ──────────────────────────────────────────────────────────────────────────────

def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def check_system():
    """Prüft RAM und laufende MLX-Prozesse."""
    log("🔍 System-Check...")
    result = subprocess.run(["vm_stat"], capture_output=True, text=True)
    lines = result.stdout
    free = int(re.search(r"Pages free:\s+(\d+)", lines).group(1))
    inactive = int(re.search(r"Pages inactive:\s+(\d+)", lines).group(1))
    wired = int(re.search(r"Pages wired down:\s+(\d+)", lines).group(1))
    active = int(re.search(r"Pages active:\s+(\d+)", lines).group(1))
    free_gb = (free + inactive) * 16384 / 1024**3
    used_gb = (active + wired) * 16384 / 1024**3
    log(f"   RAM: {used_gb:.1f} GB used / {free_gb:.1f} GB free")

    # MLX Prozesse
    mlx_check = subprocess.run(
        ["pgrep", "-la", "mlx_lm"], capture_output=True, text=True
    )
    if mlx_check.stdout.strip():
        log(f"   ⚠️  MLX läuft noch: {mlx_check.stdout.strip()[:80]}")
        return False, free_gb

    if free_gb < 6:
        log(f"   ❌ Nur {free_gb:.1f} GB frei — zu wenig für Training!")
        return False, free_gb

    log(f"   ✅ System bereit")
    return True, free_gb


def get_job(job_id: int) -> dict:
    r = requests.get(f"{API}/api/jobs/{job_id}", timeout=10)
    return r.json()


def get_latest_loss(job_id: int) -> tuple:
    """Liest letzten Loss + Iter aus Log-Datei."""
    log_path = LOG_DIR / f"groot-training-{job_id}.log"
    if not log_path.exists():
        return None, 0
    last_loss = None
    last_iter = 0
    with open(log_path) as f:
        for line in f:
            m = re.search(r"Iter\s+(\d+):\s+Train loss\s+([\d.]+)", line)
            if m:
                last_iter = int(m.group(1))
                last_loss = float(m.group(2))
    return last_loss, last_iter


def wait_for_job(job_id: int, check_interval: int = 120) -> dict:
    """Wartet bis Job abgeschlossen ist, zeigt Live-Fortschritt."""
    log(f"⏳ Warte auf Job #{job_id}...")
    last_logged_iter = 0
    while True:
        job = get_job(job_id)
        status = job.get("status")

        if status in ("completed", "failed"):
            log(f"{'✅' if status == 'completed' else '❌'} Job #{job_id} → {status.upper()}")
            if status == "completed":
                log(f"   Final Loss: {job.get('final_loss', '?')}")
            else:
                log(f"   Fehler: {job.get('error_message', '?')[:100]}")
            return job

        # Fortschritt anzeigen
        loss, iters = get_latest_loss(job_id)
        if loss and iters > last_logged_iter:
            log(f"   Iter {iters:>6} / {job.get('iters', '?')} | Loss: {loss:.4f}")
            last_logged_iter = iters

        time.sleep(check_interval)


def run_eval(model_id: int) -> dict:
    """Führt vollständige Eval-Suite durch. Gibt Ergebnisse zurück."""
    log(f"🧪 Eval-Suite für Modell #{model_id}...")
    results = []
    passes = 0
    critical_passes = 0
    critical_total = sum(1 for t in EVAL_TESTS if t["critical"])

    for i, test in enumerate(EVAL_TESTS):
        log(f"   [{i+1}/{len(EVAL_TESTS)}] {test['label']}")
        try:
            r = requests.post(
                f"{API}/api/models/{model_id}/chat",
                json={"prompt": test["q"], "max_tokens": 300},
                timeout=120,
            )
            answer = r.json().get("response", "ERROR").lower()
        except Exception as e:
            answer = f"error: {e}"
            log(f"   ❌ Fehler: {e}")

        # Bewerten
        has_pass = any(k in answer for k in test["keywords_pass"])
        has_fail = any(k in answer for k in test["keywords_fail"])

        if has_fail:
            verdict = "HALLUZINATION" if test["keywords_fail"][0] not in ["keine", "leider"] else "FAIL"
        elif has_pass:
            verdict = "PASS"
        else:
            verdict = "UNCLEAR"  # Antwort kam, aber kein klares Signal

        icon = "✅" if verdict == "PASS" else ("⚠️" if verdict == "UNCLEAR" else "❌")
        log(f"   {icon} {verdict}: {answer[:120]}")

        if verdict == "PASS":
            passes += 1
            if test["critical"]:
                critical_passes += 1

        results.append({
            "label": test["label"],
            "question": test["q"],
            "answer": answer[:300],
            "verdict": verdict,
            "critical": test["critical"],
        })
        time.sleep(2)

    pass_rate = passes / len(EVAL_TESTS)
    critical_rate = critical_passes / critical_total if critical_total > 0 else 0

    log(f"\n📊 Eval-Ergebnis: {passes}/{len(EVAL_TESTS)} PASS ({pass_rate*100:.0f}%)")
    log(f"   Kritische Tests: {critical_passes}/{critical_total} ({critical_rate*100:.0f}%)")

    return {
        "results": results,
        "passes": passes,
        "total": len(EVAL_TESTS),
        "pass_rate": pass_rate,
        "critical_passes": critical_passes,
        "critical_total": critical_total,
        "critical_rate": critical_rate,
    }


def save_learning(title: str, content: str, model: str, job_id: int, tags: str):
    """Speichert Learning im Groot-Portal."""
    payload = {
        "title": title,
        "content": content,
        "source": "training",
        "model": model,
        "job_id": job_id,
        "tags": tags,
    }
    try:
        r = requests.post(f"{API}/api/learnings", json=payload, timeout=10)
        d = r.json()
        log(f"💾 Learning #{d.get('id')} gespeichert: {title[:50]}")
    except Exception as e:
        log(f"⚠️  Learning konnte nicht gespeichert werden: {e}")


def start_new_job(params: dict, name: str) -> int:
    """Startet neuen Training-Job. Gibt Job-ID zurück."""
    payload = {**DEFAULT_PARAMS, **params, "name": name}
    r = requests.post(f"{API}/api/jobs", json=payload, timeout=10)
    job = r.json()
    job_id = job["id"]
    log(f"🚀 Job #{job_id} gestartet: {name}")
    return job_id


def decide_next_step(eval_result: dict, job: dict, run_number: int) -> dict | None:
    """
    Entscheidet ob und wie weiter trainiert werden soll.
    Returns: neue Job-Parameter oder None wenn fertig.
    """
    pass_rate = eval_result["pass_rate"]
    final_loss = job.get("final_loss") or 999
    iters = job.get("iters", 0)

    if pass_rate >= TARGET_PASS_RATE and final_loss <= QUALITY_TARGET_LOSS:
        log(f"🎯 Qualitätsziel erreicht! ({pass_rate*100:.0f}% Pass, Loss {final_loss:.3f})")
        return None  # Fertig!

    if run_number >= MAX_ITERATIONS:
        log(f"⚠️  Max Iterationen ({MAX_ITERATIONS}) erreicht — stoppe Loop.")
        return None

    # Probleme analysieren und Parameter anpassen
    halluz_count = sum(1 for r in eval_result["results"] if r["verdict"] == "HALLUZINATION")
    ood_fails = sum(1 for r in eval_result["results"]
                   if r["verdict"] != "PASS" and "ablehnen" in r["label"].lower())

    log(f"\n🔧 Analyse für nächsten Run:")
    log(f"   Pass-Rate: {pass_rate*100:.0f}% (Ziel: {TARGET_PASS_RATE*100:.0f}%)")
    log(f"   Final Loss: {final_loss:.3f} (Ziel: <{QUALITY_TARGET_LOSS})")
    log(f"   Halluzinationen: {halluz_count}")
    log(f"   OOD-Fehler: {ood_fails}")

    # Anpassungen
    new_params = {}

    if final_loss > 1.0 or iters < 20000:
        # Loss zu hoch → mehr Iters
        new_iters = min(iters + 10000, 40000)
        new_params["iters"] = new_iters
        log(f"   → Mehr Iters: {iters} → {new_iters}")

    if halluz_count >= 2:
        # Viele Halluzinationen → niedrigere LR für stabilereres Training
        current_lr = DEFAULT_PARAMS["learning_rate"]
        new_lr = round(current_lr * 0.7, 6)
        new_params["learning_rate"] = new_lr
        log(f"   → Niedrigere LR: {current_lr} → {new_lr} (weniger Halluzination)")

    if ood_fails >= 2:
        # OOD noch schlecht → weiterhin Dataset v2 mit OOD-Paaren
        log(f"   → Dataset v2 beibehalten (OOD-Paare)")

    return new_params


def build_eval_report(eval_result: dict, job: dict) -> str:
    """Baut vollständigen Eval-Bericht als Text."""
    lines = [
        f"EVAL Job #{job.get('id')} | {job.get('name', '?')}",
        f"Modell: {job.get('base_model', '?')}",
        f"Iters: {job.get('iters')} | Final Loss: {job.get('final_loss', '?')}",
        f"Score: {eval_result['passes']}/{eval_result['total']} ({eval_result['pass_rate']*100:.0f}%)",
        f"Kritisch: {eval_result['critical_passes']}/{eval_result['critical_total']}",
        "",
        "EINZELERGEBNISSE:",
    ]
    for r in eval_result["results"]:
        icon = "✅" if r["verdict"] == "PASS" else ("⚠️" if r["verdict"] == "UNCLEAR" else "❌")
        lines.append(f"{icon} {r['verdict']:15} | {r['label']}")
        lines.append(f"   Antwort: {r['answer'][:150]}")
    return "\n".join(lines)


def notify_whatsapp(msg: str):
    """Sendet Nachricht an Chris via OpenClaw."""
    try:
        subprocess.run(
            ["openclaw", "message", "--channel", "whatsapp",
             "--to", "+4915122681129", "--text", msg],
            capture_output=True, timeout=15
        )
    except Exception:
        pass  # Kein Alarm wenn Notify fehlschlägt


# ──────────────────────────────────────────────────────────────────────────────
# Haupt-Loop
# ──────────────────────────────────────────────────────────────────────────────

def run_loop(start_job_id=None):
    """Vollautomatischer Trainings-Loop."""
    log("🌱 Groot Autonomous Training Loop gestartet")
    log(f"   Qualitätsziel: {TARGET_PASS_RATE*100:.0f}% Pass-Rate | Loss < {QUALITY_TARGET_LOSS}")
    log(f"   Max Runs: {MAX_ITERATIONS}")
    log("")

    current_job_id = start_job_id
    run_number = 0
    best_pass_rate = 0.0
    best_job_id = None
    history = []

    while run_number < MAX_ITERATIONS:
        run_number += 1
        log(f"{'='*60}")
        log(f"RUN {run_number}/{MAX_ITERATIONS}")
        log(f"{'='*60}")

        # --- System-Check ---
        ok, free_gb = check_system()
        if not ok and start_job_id is None:
            log("❌ System nicht bereit — warte 5 Minuten...")
            time.sleep(300)
            ok, free_gb = check_system()
            if not ok:
                log("❌ System immer noch nicht bereit — Abbruch.")
                break

        # --- Job starten falls nötig ---
        if current_job_id is None:
            iters = DEFAULT_PARAMS["iters"]
            job_name = f"LUTZ Qwen3-4B AutoLoop Run#{run_number} {iters//1000}k"
            current_job_id = start_new_job({}, job_name)

        # --- Warten bis fertig ---
        job = wait_for_job(current_job_id, check_interval=60)

        if job["status"] == "failed":
            log(f"❌ Job #{current_job_id} fehlgeschlagen — analysiere Fehler...")
            err = job.get("error_message", "")
            if "metal" in err.lower() or "-6" in err:
                log("   → Metal GPU Crash — warte 60s und retry mit batch=1")
                time.sleep(60)
            save_learning(
                title=f"Training-Fehler Job #{current_job_id} ({datetime.now().strftime('%d.%m.%Y')})",
                content=f"FEHLER: {err}\nRun: {run_number}/{MAX_ITERATIONS}",
                model=job.get("base_model", "?"),
                job_id=current_job_id,
                tags="fehler,crash,autoloop"
            )
            current_job_id = None
            continue

        # --- Eval ---
        # Model-ID für diesen Job finden
        models = requests.get(f"{API}/api/models").json()
        model = next((m for m in models if m.get("job_id") == current_job_id), None)
        if not model:
            log(f"⚠️  Kein Modell für Job #{current_job_id} gefunden — überspringe Eval")
            current_job_id = None
            continue

        eval_result = run_eval(model["id"])
        history.append({"run": run_number, "job_id": current_job_id, "eval": eval_result, "job": job})

        if eval_result["pass_rate"] > best_pass_rate:
            best_pass_rate = eval_result["pass_rate"]
            best_job_id = current_job_id

        # --- Eval dokumentieren ---
        report = build_eval_report(eval_result, job)
        icon_map = {"PASS": "✅", "FAIL": "❌", "HALLUZINATION": "⚠️", "UNCLEAR": "🟡"}
        result_lines = [
            f"{icon_map.get(r['verdict'], '?')} {r['verdict']:15} | {r['label']}"
            for r in eval_result["results"]
        ]
        save_learning(
            title=f"AutoLoop Run#{run_number} Eval — {eval_result['passes']}/{eval_result['total']} Pass (Loss {job.get('final_loss', '?')}) | {datetime.now().strftime('%d.%m.%Y')}",
            content=report,
            model=model.get("base_model", "?"),
            job_id=current_job_id,
            tags=f"autoloop,eval,run{run_number},pass-{eval_result['passes']}-{eval_result['total']}"
        )

        # --- Qualitätsziel erreicht? ---
        if eval_result["pass_rate"] >= TARGET_PASS_RATE and (job.get("final_loss") or 999) <= QUALITY_TARGET_LOSS:
            summary = (
                f"🎯 Groot AutoLoop FERTIG!\n\n"
                f"Run {run_number}/{MAX_ITERATIONS}\n"
                f"✅ Score: {eval_result['passes']}/{eval_result['total']} ({eval_result['pass_rate']*100:.0f}%)\n"
                f"📉 Final Loss: {job.get('final_loss'):.3f}\n\n"
                + "\n".join(result_lines)
            )
            log(summary)
            notify_whatsapp(summary)
            break

        # --- Nächsten Run planen ---
        next_params = decide_next_step(eval_result, job, run_number)
        if next_params is None:
            break

        log(f"\n⏸  Pause 30s vor nächstem Run...")
        time.sleep(30)
        iters = next_params.get("iters", DEFAULT_PARAMS["iters"])
        job_name = f"LUTZ Qwen3-4B AutoLoop Run#{run_number+1} {iters//1000}k"
        current_job_id = start_new_job(next_params, job_name)

    # Abschluss-Bericht
    log(f"\n{'='*60}")
    log(f"LOOP ABGESCHLOSSEN nach {run_number} Runs")
    log(f"Bestes Ergebnis: Job #{best_job_id} | {best_pass_rate*100:.0f}% Pass-Rate")

    if history:
        summary = (
            f"🌱 Groot AutoLoop Abschluss\n\n"
            f"{run_number} Training-Runs\n"
            f"Bestes Modell: Job #{best_job_id}\n"
            f"Pass-Rate: {best_pass_rate*100:.0f}%\n\n"
            f"Details im Groot-Portal: /learnings"
        )
        notify_whatsapp(summary)


def run_eval_only(model_id: int):
    """Nur Eval-Modus für ein bestehendes Modell."""
    models = requests.get(f"{API}/api/models").json()
    model = next((m for m in models if m["id"] == model_id), None)
    if not model:
        log(f"❌ Modell #{model_id} nicht gefunden")
        sys.exit(1)

    log(f"📋 Evaluiere Modell #{model_id}: {model['name']}")
    eval_result = run_eval(model_id)
    report = build_eval_report(eval_result, {"id": model_id, "base_model": model.get("base_model"), "final_loss": model.get("final_loss"), "iters": "?", "name": model["name"]})
    print("\n" + report)

    save_learning(
        title=f"Manual Eval Modell #{model_id} — {eval_result['passes']}/{eval_result['total']} Pass | {datetime.now().strftime('%d.%m.%Y %H:%M')}",
        content=report,
        model=model.get("base_model", "?"),
        job_id=model.get("job_id"),
        tags=f"eval,manual,pass-{eval_result['passes']}-{eval_result['total']}"
    )


# ──────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Groot Autonomous Training Loop")
    parser.add_argument("--job", type=int, help="Laufenden Job monitoren + Auto-Eval")
    parser.add_argument("--start", action="store_true", help="Neuen Job starten + Loop")
    parser.add_argument("--eval", action="store_true", help="Nur Eval (kein Training)")
    parser.add_argument("--model", type=int, help="Model-ID für --eval")
    args = parser.parse_args()

    if args.eval:
        if not args.model:
            print("--eval benötigt --model <id>")
            sys.exit(1)
        run_eval_only(args.model)
    elif args.job:
        run_loop(start_job_id=args.job)
    elif args.start:
        run_loop(start_job_id=None)
    else:
        parser.print_help()
