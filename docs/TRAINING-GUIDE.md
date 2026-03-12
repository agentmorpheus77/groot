# 🌱 Groot Training Guide — Best Practices

## Übersicht

Groot nutzt **LoRA (Low-Rank Adaptation)** mit MLX auf Apple Silicon.  
LoRA trainiert nicht das gesamte Modell, sondern nur eine kleine Schicht "Adapter-Gewichte" (~0.1% der Parameter).  
Das Basismodell bleibt unverändert — der Adapter wird darüber gelegt.

---

## ✅ Empfohlene Parameter (Stand März 2026, getestet mit Qwen3 8B)

| Parameter | Empfehlung | Begründung |
|-----------|-----------|------------|
| **Iterationen** | `3.900` = 1 Epoche · `19.500` = 5 Epochen | Für Fakten-Einprägung mindestens 3 Epochen |
| **Batch Size** | `4` (Standard) · `8` (bei >32GB RAM) | Batch 4 = sicher. Batch 8 = doppelt so schnell |
| **Learning Rate** | `0.00005` (5e-5) | Niedrig bei langen Trainings. Verhindert Catastrophic Forgetting |
| **Max Seq Length** | `1024` | Mindestens so groß wie längster Trainingseintrag. Default 512 zu klein! |
| **LoRA Rank** | `8` (Standard in MLX) | Rank 8 = ideal für Qwen3. Rank 32+ zerstört /think Verhalten |
| **Num Layers** | `16` | Standard. Mehr = mehr Kapazität + mehr RAM |

---

## 📊 Wann ist das Training gut?

| Loss-Wert | Bedeutung |
|-----------|-----------|
| > 1.5 | Zu wenig trainiert — mehr Iterationen |
| 1.0 – 1.5 | Akzeptabel, aber Fakten noch unsicher |
| 0.7 – 1.0 | Gut — Modell kennt den Stil |
| 0.3 – 0.7 | Sehr gut — Fakten gut eingeprägt |
| < 0.3 | Overfitting-Risiko — Modell lernt auswendig |

**Ziel:** Loss zwischen **0.5 und 0.8** für Fakten-Training.

---

## 🔢 Iterationen berechnen

```
Iterationen = (Trainingspaare × Epochen) / Batch Size

Beispiel LUTZ-JESCO:
  15.644 Paare × 5 Epochen / 4 (Batch) = ~19.500 Iterationen
```

**Faustregel:**
- Style-Training (Tonfall ändern): 500–2.000 Iterationen
- Fakten-Training (Wissen einprägen): 10.000–20.000 Iterationen

---

## ⚠️ Häufige Fehler

### Max Seq Length zu klein
```
[WARNING] Some sequences are longer than 512 tokens → truncated to 512
```
**Fix:** `max_seq_length` auf 1024 oder 2048 setzen.  
Die längsten Einträge im LUTZ-Dataset haben ~1004 Tokens.

### Zu wenige Iterationen
Symptom: Modell antwortet generisch, kennt keine spezifischen Fakten.  
Fix: Mehr Iterationen (mindestens 3 volle Epochen).

### Learning Rate zu hoch
Symptom: Loss springt, Modell verliert allgemeine Sprachfähigkeiten.  
Fix: LR auf `0.00005` (5e-5) reduzieren.

### LoRA Rank zu hoch
Symptom: Modell wird inkonsistent, /think /no_think Verhalten bricht.  
Fix: Rank auf 8 reduzieren (MLX Standard ist 8, nicht ändern).

---

## 📁 Datenformat

MLX erwartet Dateien im Ordner `train.jsonl` / `valid.jsonl`.

Groot konvertiert beim Upload automatisch ins richtige Format.  
Optimal ist das **Chat-Format** für maximale Kontrolle:

```json
{"messages": [
  {"role": "user", "content": "Frage hier"},
  {"role": "assistant", "content": "Antwort hier"}
]}
```

Das aktuelle LUTZ-Dataset verwendet **Text-Format** (automatisch konvertiert).

---

## 🏆 LUTZ-JESCO Trainingshistorie

| Job | Iterationen | LR | Seq Len | Loss | Ergebnis |
|-----|-------------|-----|---------|------|---------|
| Job 3 | 500 | 0.0001 | 512 | — | Zu wenig |
| Job 7 | 1.000 | 0.0001 | 512 | 1.291 | Stil leicht besser, Fakten unsicher |
| Job 8 | 1.000 | 0.0001 | 512 | 1.164 | Clean-Daten, aber noch zu wenig |
| **Job 10** | **20.000** | **0.00005** | **1024** | — | Overnight — Ziel: Loss < 0.8 |

---

## 🚀 Empfohlenes Vorgehen für neue Datasets

1. **Dataset hochladen** (JSONL mit prompt/completion Paaren)
2. **Testlauf:** 500 Iterationen, Batch 4, LR 0.0001 → Loss prüfen
3. **Volltraining:** `(Paare × 3–5) / Batch` Iterationen, LR 0.00005
4. **Modell im Chat testen** mit spezifischen Fragen aus dem Trainingsset
5. **Bei Loss > 1.0:** Mehr Iterationen oder Datenqualität verbessern

---

## 💾 OOM (Out of Memory) — Diagnose & Fix

### Symptom
```
[METAL] Insufficient Memory (kIOGPUCommandBufferCallbackErrorOutOfMemory)
```
Tritt auf wenn Peak-RAM den verfügbaren Unified Memory überschreitet.  
Getestet: Qwen3-8B + Seq 1024 + Batch 4 = ~28.8 GB Peak → crasht auf 64GB Studio wenn andere Dienste laufen!

### Ursachen prüfen (zuerst!)
Bevor Parameter geändert werden: **Was läuft sonst noch auf dem Mac?**
```bash
# RAM-Fresser checken
ps aux --sort=-%mem | head -15

# LLM-Server im Hintergrund?
ps aux | grep -iE 'ollama|lmstudio|llama|mlx|vllm'

# Ports checken
lsof -iTCP -sTCP:LISTEN -P | grep -E '11434|8080|1234|7860'
```
→ Ollama, LM Studio, ACE-Step etc. fressen 8-20GB RAM auch im Idle!  
→ Diese Dienste **vor dem Training stoppen**.

### Die 3 Memory-Schrauben (gerankt nach Wirkung)

| Schraube | RAM-Ersparnis | Nachteil | Flag |
|---------|---------------|---------|------|
| **`--grad-checkpoint`** | **30-40%** | ~15% langsamer | `--grad-checkpoint` |
| **Batch 2 + Accumulation 2** | ~50% Peak | gleiche Effektivität | `--batch-size 2 --grad-accumulation-steps 2` |
| **Weniger Layers** | ~20% | weniger Lernkapazität | `--num-layers 8` |

### Empfohlene Kombination (OOM-sicher, volle Qualität)
```
--batch-size 2
--grad-accumulation-steps 2   # Effektiver Batch bleibt 4
--grad-checkpoint             # 30-40% weniger Peak-RAM
--num-layers 16               # Behalten
--max-seq-length 1024         # Behalten
--iters 20000
--learning-rate 0.00005
```
**Effektiver Batch = batch_size × grad_accumulation_steps = 2 × 2 = 4**  
→ Gleiche Trainingsqualität wie Batch 4, aber ~40-50% weniger Spitzen-RAM (~17-20GB)

### Warum grad-checkpoint funktioniert
Gradient Checkpointing speichert intermediate Aktivierungen **nicht** während des Forward-Pass.  
Stattdessen werden sie im Backward-Pass neu berechnet.  
**Trade-off:** Mehr Rechenzeit, viel weniger RAM.

---

*Letzte Aktualisierung: März 2026*
