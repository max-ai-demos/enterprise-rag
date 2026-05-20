#!/usr/bin/env bash
# scripts/dev/start-local-web.sh
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

AGENT_PORT=$(cat .runtime/local-agent-port 2>/dev/null || echo "8001")
export AGENT_URL="http://localhost:${AGENT_PORT}"
# standalone server does process.chdir(__dirname), so relative paths break — use absolute
export DATABASE_PATH="${ROOT_DIR}/data/enterprise_rag.db"

# Build if .next/standalone doesn't exist
if [ ! -f "apps/web/.next/standalone/server.js" ]; then
  echo "需要先 build：cd apps/web && npm run build"
  exit 1
fi

exec npm --prefix apps/web run start
