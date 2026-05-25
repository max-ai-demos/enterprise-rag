#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEMOS_DIR="$(cd "$REPO/.." && pwd)"
PORTS_PY="$DEMOS_DIR/scripts/load-ports.py"
WEB_PORT=$(python3 "$PORTS_PY" "enterprise-rag" web)
AGENT_PORT=$(python3 "$PORTS_PY" "enterprise-rag" agent 2>/dev/null || echo "")
DOMAIN=$(python3 "$PORTS_PY" "enterprise-rag" domain)
WEB_DIR="$REPO/apps/web"
PORT=$WEB_PORT
LOG="/Users/mac/.doc-cloud/logs/enterprise-rag-frontend.log"

OLD=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $2}' | head -1 || true)
[ -n "$OLD" ] && kill "$OLD" 2>/dev/null || true
sleep 1

cd "$WEB_DIR"
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static && cp -R .next/static .next/standalone/.next/static
[ -d public ] && { rm -rf .next/standalone/public && cp -R public .next/standalone/public; } || true

mkdir -p "$REPO/.runtime"
JWT_SECRET=enterprise-demo-shared-secret-2026 \
AGENT_URL=http://localhost:${AGENT_PORT} \
DB_HOST=localhost DB_PORT=3306 DB_USER=root DB_PASSWORD=Lyx2020. DB_NAME=enterprise_rag \
HOSTNAME=0.0.0.0 PORT=$WEB_PORT \
nohup node .next/standalone/server.js > "$LOG" 2>&1 &
echo $! > "$REPO/.runtime/web.pid"
echo "web started on :$PORT (PID $!)"
