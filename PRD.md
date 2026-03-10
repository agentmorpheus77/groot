# Groot – LLM Training Studio PRD

## Vision
Ein lokales Web-Tool zum Verwalten, Trainieren und Testen eigener LLM Fine-Tunes.
Name: "Groot" — wächst mit jedem neuen Datenbatch.

## Stack
- **Backend:** FastAPI (Python)
- **Frontend:** React + Tailwind CSS
- **Training:** MLX-LM (Apple Silicon M1 Ultra optimiert)
- **Serving:** Ollama (fertige Modelle ausführen)
- **DB:** SQLite (Jobs, Datasets, Models)
- **Design:** Dark Theme, CDBrain Brand Colors (#000e22, #ffaa3a)

## Core Features (MVP)

### 1. Dataset Manager
- Drag & Drop Upload von JSONL/CSV/JSON Dateien
- Format: {"prompt": "...", "completion": "..."} oder {"question": "...", "answer": "..."}
- Auto-Konvertierung in Trainingsformat
- Dataset-Liste mit Name, Anzahl Q&A-Paare, Upload-Datum
- Preview: erste 10 Einträge anzeigen
- Delete

### 2. Training Job Manager
- Neuen Job anlegen: Dataset auswählen + Base Model wählen
- Base Models: mlx-community/Llama-3.2-1B-Instruct-4bit, mlx-community/Mistral-7B-Instruct-v0.3-4bit
- Config: Epochs (1-10), Learning Rate, Max Seq Length
- Job starten → Live-Log-Streaming im Browser
- Job-Status: queued / running / completed / failed
- Jobs-Liste mit Dauer, Loss-Kurve (wenn verfügbar)

### 3. Model Library
- Alle fertig trainierten Modelle auflisten
- Info: Basis-Modell, Dataset, Trainingszeit, Datum
- Aktionen: Testen, Löschen, Als Ollama-Modell deployen

### 4. Chat Interface (Model Testing)
- Modell aus Library auswählen
- Chat-UI zum Testen
- Vergleichs-Modus: 2 Modelle side-by-side

## API Endpoints
- POST /api/datasets/upload
- GET /api/datasets
- DELETE /api/datasets/{id}
- POST /api/jobs (start training)
- GET /api/jobs
- GET /api/jobs/{id}/logs (SSE streaming)
- GET /api/models
- POST /api/models/{id}/chat
- DELETE /api/models/{id}

## Training Pipeline (MLX-LM)
```bash
# Fine-tuning command
mlx_lm.lora \
  --model mlx-community/Llama-3.2-1B-Instruct-4bit \
  --train \
  --data /data/datasets/{dataset_id}/ \
  --iters 1000 \
  --batch-size 4 \
  --lora-layers 16 \
  --save-every 100 \
  --adapter-path /data/adapters/{job_id}/
  
# Fusing adapter with base model
mlx_lm.fuse \
  --model mlx-community/Llama-3.2-1B-Instruct-4bit \
  --adapter-path /data/adapters/{job_id}/ \
  --save-path /data/models/{job_id}/
```

## File Structure
```
groot/
├── backend/
│   ├── main.py          # FastAPI app
│   ├── database.py      # SQLite models
│   ├── training.py      # MLX-LM wrapper
│   ├── router/
│   │   ├── datasets.py
│   │   ├── jobs.py
│   │   └── models.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Datasets.tsx
│   │   │   ├── Training.tsx
│   │   │   ├── Models.tsx
│   │   │   └── Chat.tsx
│   │   └── components/
│   └── package.json
├── data/
│   ├── datasets/
│   ├── adapters/
│   └── models/
├── groot.db
└── start.sh
```

## Design System
- **Component Library:** shadcn/ui (Standard-Komponenten: Button, Card, Table, Dialog, Input, Select, Badge, Progress, Tabs, Sidebar)
- **Dark/Light Theme:** next-themes oder shadcn ThemeProvider — Toggle in der Navbar
  - Dark: Background #000e22, Accent #ffaa3a (CDBrain Brand)
  - Light: Clean white/gray, Accent #ffaa3a
- Font: Roboto / system-ui
- Sidebar navigation (Dashboard, Datasets, Training, Models, Chat)
- Alle shadcn-Komponenten mit CDBrain-Farben via CSS Variables in globals.css

## Multilingual (i18n)
- Library: i18next + react-i18next
- Sprachen: Deutsch (de) + Englisch (en) — Sprachauswahl in der Navbar
- Alle UI-Texte via t("key") — keine hardcodierten Strings
- Locale-Dateien: public/locales/de/translation.json + public/locales/en/translation.json
- Default: Deutsch

## Start Script
```bash
#!/bin/bash
# start.sh — startet Backend + Frontend
cd backend && uvicorn main:app --host 0.0.0.0 --port 8765 &
cd frontend && npm run build && # served via FastAPI StaticFiles
```

## Test-Daten für heute Abend
Shakespeare-Texte als Mini-Dataset (aus nanoGPT bekannt):
- 10 Q&A-Paare über Shakespeare-Charaktere
- Ziel: kompletten Workflow durchlaufen (upload → train → test)

## Deployment
- Port: 8765
- Cloudflare Tunnel: groot.cdbrain.de (optional)
- Läuft permanent auf Mac Studio

## Status
- [ ] Backend Setup
- [ ] Frontend Setup  
- [ ] Training Pipeline (MLX-LM)
- [ ] Dataset Upload
- [ ] Job Manager mit Live-Logs
- [ ] Model Library
- [ ] Chat Interface
- [ ] Test-Run mit Dummy-Daten
