# Web 应用 & 数据库 — 系统设计文档

**日期**：2026-05-20  
**状态**：已确认  
**关联**：[Agent 设计文档](./2026-05-20-enterprise-rag-agent-design.md)

---

## 1. 整体结构

`enterprise-rag` 是一个项目，包含两个子应用：

```
enterprise-rag/
  apps/
    web/        ← Next.js 14，本文设计范围
    agent/      ← Python FastAPI，见 agent 设计文档
  data/                         ← 两个 app 共用的数据目录
    enterprise_rag.db           ← SQLite 数据库（唯一数据库）
    uploads/                    ← 上传文件（agent 写，web 读）
    demo/                       ← Feature Demo 文档（固定，只读）
    chroma_db/                  ← 向量数据库（agent 使用）
  scripts/
    init_db.py                  ← 初始化脚本（创建表 + 写入默认用户）
    init.sql                    ← 建表 SQL
```

---

## 2. 数据库设计

### users 表

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,              -- bcrypt
  role          TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**初始用户（5 个固定账号，由 `scripts/init_db.py` 写入）：**

| username | 初始密码 | role |
|---|---|---|
| admin | Admin@2026 | admin |
| demo1 | Demo@2026 | user |
| demo2 | Demo@2026 | user |
| demo3 | Demo@2026 | user |
| demo4 | Demo@2026 | user |

> 不支持注册，不支持前端新增用户。如需修改用户，直接编辑 `scripts/init_db.py` 重新初始化。

### documents 表

```sql
CREATE TABLE documents (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,              -- NULL = demo 文档（所有登录用户可见）
  filename    TEXT NOT NULL,
  file_path   TEXT NOT NULL,     -- 相对路径，相对于 data/
  file_type   TEXT NOT NULL,     -- pdf | docx | xlsx | txt
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|processing|ready|failed
  is_demo     INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  file_size   INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### chat_sessions 表

```sql
CREATE TABLE chat_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT,              -- 取首问题前 30 字自动生成
  mode       TEXT NOT NULL DEFAULT 'upload', -- 'upload' | 'demo'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### messages 表

```sql
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role       TEXT NOT NULL,     -- 'user' | 'assistant'
  content    TEXT NOT NULL,
  sources    TEXT,              -- JSON，assistant 消息携带引用来源
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
);
```

**sources JSON 结构：**
```json
[
  {
    "document_id": "uuid",
    "filename": "合同.pdf",
    "file_type": "pdf",
    "page_num": 3,
    "chunk_text": "...相关原文片段...",
    "score": 0.92
  }
]
```

---

## 3. Web 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 框架 | Next.js 14 (App Router) | SSR + API Routes |
| 样式 | Tailwind CSS | |
| 认证 | JWT（httpOnly Cookie） | Next.js middleware 保护路由 |
| DB 访问 | better-sqlite3 | API Routes 直接读写 SQLite |
| PDF 预览 | 复制自 xxx-ai-frontend | `features/documents/pdf-viewer/` |
| Word 预览 | mammoth.js | .docx → HTML，浏览器渲染，无需服务端转换 |
| Excel 预览 | SheetJS (xlsx) | .xlsx → HTML 表格，浏览器渲染 |
| txt 预览 | 纯文本 | 直接渲染 |
| SSE 流 | 复制自 xxx-ai-frontend | `features/chat/sse-stream.ts`（精简版） |

---

## 4. 路由

```
/login         ← 登录（公开）
/              ← 重定向 /demo（已登录）或 /login
/demo          ← Feature Demo（需登录）
/chat          ← 我的知识库（需登录）
```

无管理员页面。

---

## 5. 页面布局

### Feature Demo `/demo` 与 我的知识库 `/chat`（共用布局）

```
┌─────────────────────────────────────────────────────────────┐
│  导航栏：[Logo]   Feature Demo   我的知识库   [用户名 退出]   │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  左侧面板    │  右侧主区域                                   │
│  ──────      │  ─────────────────────                       │
│  会话列表    │  对话气泡（流式输出）                          │
│  + 新建      │                                              │
│              │  [引用来源卡片] → 点击打开文件预览             │
│  ──────      │                                              │
│  文档列表    │  ─────────────────────                       │
│  （Demo 只   │  输入框 + 发送                                │
│   读，Chat   │                                              │
│   可上传）   │                                              │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

点击引用来源 → **弹出文件预览 Modal，自动跳转到对应位置**

---

## 6. 文件预览与原文跳转

| 格式 | 预览方案 | 跳转实现 |
|---|---|---|
| PDF | xxx-ai-frontend PDFViewer（直接复用） | `scrollToPage(page_num)` |
| Word (.docx) | mammoth.js 转 HTML，浏览器内渲染 | 按 `paragraph_idx` 用 `scrollIntoView` |
| Excel (.xlsx) | SheetJS 转 HTML 表格，浏览器内渲染 | 按 `sheet_name + row_start` 高亮行并滚动 |
| txt | 纯文本 | 按 `char_offset` 高亮并滚动 |

所有格式的跳转逻辑：agent 返回 sources 时携带位置元数据 → 前端根据 `file_type` 选择对应 viewer → 传入位置参数触发滚动 + 高亮。

---

## 7. 认证流程

```
POST /api/auth/login
  → 验证 username + password (bcrypt)
  → 签发 JWT (payload: { user_id, username, role })
  → 写入 httpOnly Cookie

Next.js middleware.ts
  → /demo、/chat 检查 Cookie 有效性
  → 无效 → 重定向 /login

API Routes
  → 从 Cookie 解析 user_id
  → 转发请求到 agent（localhost:8000），携带 user_id
```

---

## 8. Web ↔ Agent 通信

浏览器不直接访问 agent，所有请求经过 Next.js API Routes：

```
浏览器 → Next.js API Route（验证 JWT + 注入 user_id）→ Python agent（localhost:8000）
                                                       ↓ SSE 流
浏览器 ←────────────── Next.js 透传 SSE ──────────────
```

---

## 9. 环境变量

**apps/web/.env.local**
```
AGENT_URL=http://localhost:8000
JWT_SECRET=enterprise-rag-secret-2026
DATABASE_PATH=../../data/enterprise_rag.db
```

**apps/agent/.env**
```
DATABASE_PATH=../../data/enterprise_rag.db
UPLOAD_DIR=../../data/uploads
DEMO_DIR=../../data/demo
CHROMA_DIR=../../data/chroma_db
OPENAI_API_KEY=（从 Mac 钥匙串读取）
MEM0_ENABLED=false
```

---

## 10. 不在本期范围

- 用户注册、新增、删除
- 管理员 UI
- 文件版本管理
- 移动端适配
- 密码修改 UI（直接改 init_db.py 重跑即可）
