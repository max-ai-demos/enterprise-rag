---
name: deploy
description: Use when deploying enterprise-rag in process mode on the maintainer machine. Always uses start-local-agent.sh and start-local-web.sh — never Docker.
---

# Enterprise RAG Process Mode Deploy Workflow

Read [references/current-runtime.md](./references/current-runtime.md) before touching live services.

## Workflow

### 1. Inspect current state
- Run `git status`, `lsof -nP -iTCP -sTCP:LISTEN`, `ps auxww`
- Note processes on ports 3001 (web) and any 8001-8005 (agent)

### 2. Update code
- Check for uncommitted changes before `git pull`
- If web dependencies changed: `npm --prefix apps/web install`
- If agent dependencies changed: `cd apps/agent && .venv/bin/pip install -r requirements.txt`

### 3. Bump version (patch) — both files must stay in sync

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ working tree 不干净"; exit 1
fi

CURRENT=$(node -p "require('./apps/web/package.json').version")
NEW=$(node -p "const [a,b,c]='$CURRENT'.split('.').map(Number); \`\${a}.\${b}.\${c+1}\`")
echo "Bumping $CURRENT → $NEW"

node -e "
  const fs=require('fs'), p='./apps/web/package.json';
  const pkg=JSON.parse(fs.readFileSync(p));
  pkg.version='$NEW';
  fs.writeFileSync(p, JSON.stringify(pkg,null,2)+'\n');
"
sed -i '' "s/^version = \".*\"/version = \"$NEW\"/" apps/agent/pyproject.toml

git add apps/web/package.json apps/agent/pyproject.toml
git commit -m "chore: bump version to $NEW"
```

- Rebuild web: `npm --prefix apps/web run build`

### 4. Restart services

**Agent:**
```bash
AGENT_PORT=$(cat .runtime/local-agent-port 2>/dev/null || echo "8001")
pkill -f "uvicorn main:app.*${AGENT_PORT}" || true
bash scripts/dev/start-local-agent.sh &
```

**Web:**
```bash
pkill -f "standalone/server.js" || true
bash scripts/dev/start-local-web.sh &
```

### 5. 验活

```bash
EXPECTED=$(node -p "require('./apps/web/package.json').version")

smoke() {
  local label=$1 base=$2
  echo "=== 验活: $label ==="

  WEB=$(curl -fsS "$base/api/health")
  echo "$WEB" | python3 -m json.tool
  WEB_VER=$(echo "$WEB" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
  [ "$WEB_VER" = "$EXPECTED" ] || { echo "❌ 版本不符 (期望 $EXPECTED, 实际 $WEB_VER)"; return 1; }

  AUTH=$(curl -fsS -X POST "$base/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"demo1","password":"Demo@2026"}' \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("ok" if d.get("user_id") or d.get("username") else "fail")')
  [ "$AUTH" = "ok" ] || { echo "❌ 登录失败"; return 1; }

  echo "✓ $label 验活通过 (version: $EXPECTED)"
}

smoke "localhost" "http://localhost:3001"
smoke "rag.luyaxiang.com" "https://rag.luyaxiang.com"
```

## Quick Reference

- Repo root: `/Users/mac/Desktop/code/ai-demos/enterprise-rag`
- Start agent: `bash scripts/dev/start-local-agent.sh`
- Start web: `bash scripts/dev/start-local-web.sh`
- Local health: `http://localhost:3001/api/health`
- Live health: `https://rag.luyaxiang.com/api/health`
