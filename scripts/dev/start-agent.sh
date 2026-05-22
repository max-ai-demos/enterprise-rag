#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
AGENT_DIR="$REPO/apps/agent"
PORT=8001
LOG="/Users/mac/.doc-cloud/logs/enterprise-rag-backend.log"

pkill -f "uvicorn main:app.*$PORT" 2>/dev/null || true
sleep 1

cd "$AGENT_DIR"
set -a; source .env; set +a
unset ALL_PROXY all_proxy  # SOCKS proxy breaks httpx without socksio
mkdir -p "$REPO/.runtime"
nohup .venv/bin/uvicorn main:app --host 0.0.0.0 --port $PORT > "$LOG" 2>&1 &
echo $! > "$REPO/.runtime/agent.pid"
echo "agent started on :$PORT (PID $!)"
