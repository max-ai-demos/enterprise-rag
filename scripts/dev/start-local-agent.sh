#!/usr/bin/env bash
# scripts/dev/start-local-agent.sh
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

if [ ! -x "apps/agent/.venv/bin/python" ]; then
  echo "缺少 apps/agent/.venv，请先：cd apps/agent && python -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

# Read OpenAI key from Mac keychain (openclaw convention), then fall back to apps/agent/.env
if [ -z "${OPENAI_API_KEY:-}" ]; then
  OPENAI_API_KEY=$(security find-generic-password -s "openclaw/personal/openai/default_api_key" -a "mac" -w 2>/dev/null || true)
fi
if [ -z "${OPENAI_API_KEY:-}" ] && [ -f "apps/agent/.env" ]; then
  OPENAI_API_KEY=$(grep -E '^OPENAI_API_KEY=' apps/agent/.env | cut -d= -f2- | tr -d '"'"'" | head -1 || true)
fi
if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "❌ OPENAI_API_KEY 未设置 — 请在钥匙串 (openclaw/personal/openai/default_api_key) 或 apps/agent/.env 中配置"
  exit 1
fi
export OPENAI_API_KEY

# Unset ALL_PROXY/all_proxy (SOCKS5 proxies break httpx if socksio isn't installed).
# Keep HTTP_PROXY/HTTPS_PROXY — they point to a local HTTP CONNECT proxy that OpenAI
# calls must go through because direct TCP to api.openai.com is blocked on this machine.
unset ALL_PROXY all_proxy

find_free_port() {
  for p in 8001 8002 8003 8004 8005; do
    if ! lsof -nP -iTCP:"${p}" -sTCP:LISTEN >/dev/null 2>&1; then echo "${p}"; return 0; fi
  done
  return 1
}

AGENT_PORT=${AGENT_PORT:-$(find_free_port)}
mkdir -p .runtime
printf '%s\n' "${AGENT_PORT}" > .runtime/local-agent-port
echo "enterprise-rag agent 启动端口: ${AGENT_PORT}"

cd apps/agent
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port "${AGENT_PORT}"
