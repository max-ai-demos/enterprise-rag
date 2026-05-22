#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WEB_DIR="$REPO/apps/web"
PORT=3001
LOG="/Users/mac/.doc-cloud/logs/enterprise-rag-frontend.log"

OLD=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $2}' | head -1)
[ -n "$OLD" ] && kill "$OLD" 2>/dev/null || true
sleep 1

cd "$WEB_DIR"
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static && cp -R .next/static .next/standalone/.next/static
[ -d public ] && { rm -rf .next/standalone/public && cp -R public .next/standalone/public; } || true

mkdir -p "$REPO/.runtime"
JWT_SECRET=enterprise-demo-shared-secret-2026 \
AGENT_URL=http://localhost:8001 \
DB_HOST=localhost DB_PORT=3306 DB_USER=root DB_PASSWORD=Lyx2020. DB_NAME=enterprise_rag \
HOSTNAME=0.0.0.0 PORT=$PORT \
nohup node .next/standalone/server.js > "$LOG" 2>&1 &
echo $! > "$REPO/.runtime/web.pid"
echo "web started on :$PORT (PID $!)"
