# Current Runtime Topology

## Canonical Paths

- Repo root: `/Users/mac/Desktop/code/ai-demos/enterprise-rag`
- Nginx config: `/Users/mac/.doc-cloud/config/rag-luyaxiang-enterprise-rag.nginx.conf`

## Domain Chain

1. `cloudflared` routes `rag.luyaxiang.com` → `127.0.0.1:5174`
2. `nginx` on `127.0.0.1:5174`
3. Next.js web on `127.0.0.1:3001`
4. Python agent on `127.0.0.1:8001` (default, see `.runtime/local-agent-port`)

## Notes

- Web port: **3001** (3000 is reserved for smart-agriculture)
- Agent port: dynamic, written to `.runtime/local-agent-port` by start-local-agent.sh
- Never Docker for this project — process mode only
- Nginx config template: see `infra/nginx/rag-luyaxiang.nginx.conf`
