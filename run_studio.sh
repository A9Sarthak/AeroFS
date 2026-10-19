#!/usr/bin/env bash
# ============================================================
#  AeroFS Studio — Unified Launch Script
#  Starts FastAPI backend on port 8000 and Vite React dev server on port 5173
# ============================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=================================================="
echo "  ⚡ Starting AeroFS Studio Storage Subsystem"
echo "=================================================="

# Check virtual environment
if [ -d "$DIR/.venv" ]; then
    PYTHON="$DIR/.venv/bin/python3"
else
    PYTHON="python3"
fi

# Clean up subprocesses on exit
cleanup() {
    echo ""
    echo "Stopping AeroFS Studio services..."
    kill $(jobs -p) 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Start FastAPI backend
echo "▶ Starting FastAPI Backend (http://localhost:8000)..."
$PYTHON -m uvicorn aerofs.app:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait for backend to be ready
sleep 1.5

# Start Vite React frontend
echo "▶ Starting Vite React Studio (http://localhost:5173)..."
cd "$DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "🚀 AeroFS Studio is live!"
echo "   - Web Interface: http://localhost:5173"
echo "   - REST API Docs: http://localhost:8000/docs"
echo "Press Ctrl+C to shutdown both services."
echo ""

wait
