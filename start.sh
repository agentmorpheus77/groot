#!/usr/bin/env bash
# ─────────────────────────────────────────────────
# Groot – LLM Training Studio  |  start.sh
# ─────────────────────────────────────────────────
set -e

export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:$PATH
GROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$GROOT_DIR/frontend"
BACKEND_DIR="$GROOT_DIR/backend"
PORT=8765

echo ""
echo "  🌱  Groot LLM Training Studio"
echo "  ──────────────────────────────"
echo ""

# ── Step 1: Frontend Build ──────────────────────
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "📦 Installing frontend dependencies..."
  cd "$FRONTEND_DIR"
  npm install --legacy-peer-deps
fi

echo "🔨 Building React frontend..."
cd "$FRONTEND_DIR"
npm run build 2>&1 | tail -5

if [ ! -d "$FRONTEND_DIR/dist" ]; then
  echo "❌ Frontend build failed!"
  exit 1
fi
echo "✅ Frontend built → frontend/dist/"

# ── Step 2: Start Backend ───────────────────────
echo ""
echo "🚀 Starting FastAPI backend on port $PORT..."
cd "$BACKEND_DIR"

# Kill existing process on that port (gracefully)
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null || true
sleep 0.5

/opt/homebrew/bin/python3 -m uvicorn main:app \
  --host 0.0.0.0 \
  --port $PORT \
  --reload \
  --log-level info &

BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# ── Step 3: Wait & check ────────────────────────
echo "⏳ Waiting for backend to be ready..."
for i in $(seq 1 20); do
  sleep 1
  if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    echo ""
    echo "  ✅ Groot is running!"
    echo "  🌐 http://localhost:$PORT"
    echo "  📚 API Docs: http://localhost:$PORT/docs"
    echo ""
    echo "  Press Ctrl+C to stop"
    echo ""
    wait $BACKEND_PID
    exit 0
  fi
  echo -n "."
done

echo ""
echo "⚠️  Backend may still be starting. Check: http://localhost:$PORT"
wait $BACKEND_PID
