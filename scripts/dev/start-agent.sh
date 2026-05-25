#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEMOS_DIR="$(cd "$REPO/.." && pwd)"
PORTS_PY="$DEMOS_DIR/scripts/load-ports.py"
WEB_PORT=$(python3 "$PORTS_PY" "enterprise-rag" web)
AGENT_PORT=$(python3 "$PORTS_PY" "enterprise-rag" agent 2>/dev/null || echo "")
DOMAIN=$(python3 "$PORTS_PY" "enterprise-rag" domain)
AGENT_DIR="$REPO/apps/agent"
PORT=$AGENT_PORT
LOG="/Users/mac/.doc-cloud/logs/enterprise-rag-backend.log"

pkill -f "uvicorn main:app.*$PORT" 2>/dev/null || true
sleep 1

cd "$AGENT_DIR"
set -a; source .env; set +a
unset ALL_PROXY all_proxy  # SOCKS proxy breaks httpx without socksio
mkdir -p "$REPO/.runtime"
RAG_SERVICE_URL="http://localhost:$(python3 "$PORTS_PY" "_rag_service" agent)" \
CORS_ORIGINS="http://localhost:${WEB_PORT},https://${DOMAIN}" \
nohup .venv/bin/uvicorn main:app --host 0.0.0.0 --port $PORT > "$LOG" 2>&1 &
echo $! > "$REPO/.runtime/agent.pid"
echo "agent started on :$PORT (PID $!)"
