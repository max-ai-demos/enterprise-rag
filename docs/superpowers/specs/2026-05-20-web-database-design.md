# Web 应用 & 数据库 — 系统设计文档

**日期**：2026-05-20  
**状态**：草稿，待用户确认  
**关联**：[Agent 设计文档](./2026-05-20-enterprise-rag-agent-design.md)

---

## 1. 整体架构

```
enterprise-rag/
  apps/
    web/        ← Next.js 14 (App Router)，本文设计范围
    agent/      ← Python FastAPI，见 agent 设计文档
  data/
    enterprise_rag.db   ← 共享 SQLite 数据库
    init.sql            ← 数据库初始化脚本（含默认用户）
    uploads/            ← 原始上传文件（agent 写入，web 读取）
    chroma_db/          ← 向量数据库（agent 使用）
```

**两个 app 共用一个 SQLite 数据库**：
- `apps/web`：读写 `users`、`chat_sessions`、`messages`，处理认证
- `apps/agent`：读写 `documents`、`chat_sessions`、`messages`，处理 RAG

---

## 2. 数据库设计（完整）

### 2.1 users 表

```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,           -- UUID
  username    TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,            -- bcrypt hash
  role        TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
  is_active   INTEGER NOT NULL DEFAULT 1, -- 1=active, 0=deactivated
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.2 documents 表

```sql
CREATE TABLE documents (
  id          TEXT PRIMARY KEY,           -- UUID
  user_id     TEXT,                       -- NULL 表示 demo 文档（公共）
  filename    TEXT NOT NULL,
  file_path   TEXT NOT NULL,              -- 相对于 data/uploads/
  file_type   TEXT NOT NULL,              -- pdf | docx | xlsx | txt
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|processing|ready|failed
  is_demo     INTEGER NOT NULL DEFAULT 0, -- 1=feature demo 文档
  chunk_count INTEGER DEFAULT 0,
  file_size   INTEGER,                    -- bytes
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 2.3 chat_sessions 表

```sql
CREATE TABLE chat_sessions (
  id          TEXT PRIMARY KEY,           -- UUID
  user_id     TEXT NOT NULL,
  title       TEXT,                       -- 取首问题前 30 字自动生成
  mode        TEXT NOT NULL DEFAULT 'upload', -- 'upload' | 'demo'
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 2.4 messages 表

```sql
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,           -- UUID
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,              -- 'user' | 'assistant'
  content     TEXT NOT NULL,
  sources     TEXT,                       -- JSON，仅 assistant 消息有值
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
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

### 2.5 init.sql（含初始数据）

```sql
-- 建表（见上方各表定义）
-- ...（建表语句）

-- 默认管理员用户（密码: admin123，需首次登录后修改）
INSERT INTO users (id, username, password_hash, role) VALUES
  ('usr_admin', 'admin', '$2b$12$...bcrypt_hash...', 'admin');

-- 初始普通用户示例（密码均为 demo123）
INSERT INTO users (id, username, password_hash, role) VALUES
  ('usr_001', 'user1', '$2b$12$...bcrypt_hash...', 'user'),
  ('usr_002', 'user2', '$2b$12$...bcrypt_hash...', 'user');

-- Feature Demo 文档占位（实际文件路径待用户提供后补充）
-- INSERT INTO documents (id, user_id, filename, file_path, file_type, is_demo) VALUES ...
```

> 注：init.sql 中的 bcrypt hash 由初始化脚本生成，不直接写明文密码。
> 项目提供 `scripts/init_db.py` 脚本，执行 init.sql 并生成正确的 hash。

---

## 3. Web 应用技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 框架 | Next.js 14 (App Router) | SSR + API Routes |
| 样式 | Tailwind CSS | 与 xxx-ai-frontend 一致 |
| 状态管理 | Zustand | 轻量，参考现有项目 |
| 认证 | JWT（httpOnly Cookie） | Next.js middleware 保护路由 |
| 数据库访问 | better-sqlite3（同步） | Next.js API Routes 中直接访问 SQLite |
| PDF 预览 | 复制自 xxx-ai-frontend | `features/documents/pdf-viewer/` |
| SSE 流 | 复制自 xxx-ai-frontend | `features/chat/sse-stream.ts`（精简） |
| Word 预览 | mammoth.js | .docx → HTML 渲染 |
| Excel 预览 | SheetJS (xlsx) | 渲染为 HTML 表格 |

---

## 4. 页面路由设计

```
/login              ← 登录页（公开）
/                   ← 重定向到 /demo（已登录）或 /login
/demo               ← Feature Demo（需登录）
/chat               ← 我的知识库问答（需登录）
/admin              ← 管理员面板（需 admin 角色）
/admin/users        ← 用户管理
```

---

## 5. 页面详细设计

### 5.1 登录页 `/login`

- 用户名 + 密码表单
- 登录成功 → JWT 写入 httpOnly Cookie → 跳转 `/demo`
- 无注册入口

### 5.2 Feature Demo `/demo`

```
┌──────────────────────────────────────────────────────┐
│  导航栏：Logo | Demo | 我的知识库 | 退出              │
├────────────────┬─────────────────────────────────────┤
│                │                                     │
│  Demo 文档列表  │     对话区域                         │
│  ─────────     │     ─────────────────               │
│  📄 合同.pdf   │     AI: 你好！这里有以下演示文档：    │
│  📊 报表.xlsx  │     • 合同.pdf                      │
│  📝 规范.docx  │     • 报表.xlsx                     │
│                │     • 规范.docx                     │
│  （只读，不可   │     你可以直接提问，例如：            │
│   删除/上传）  │     "合同的付款条款是什么？"           │
│                │     ─────────────────               │
│                │     [引用来源] → 点击跳转原文         │
│                │     ─────────────────               │
│                │  ┌─────────────────────────────┐   │
│                │  │  输入框...              [发送] │   │
│                │  └─────────────────────────────┘   │
└────────────────┴─────────────────────────────────────┘
```

点击引用来源 → 右侧或弹出文件预览，**自动跳到对应页码/段落**

### 5.3 我的知识库 `/chat`

```
┌──────────────────────────────────────────────────────┐
│  导航栏：Logo | Demo | 我的知识库 | 退出              │
├────────────────┬─────────────────────────────────────┤
│                │                                     │
│  我的文档      │  对话历史（左侧 session 列表）        │
│  ─────────     │  + 当前对话内容                      │
│  [+ 上传文档]  │                                     │
│                │  （结构与 Demo 页相同）               │
│  📄 文件A.pdf  │                                     │
│    ✅ 已就绪   │                                     │
│  📊 文件B.xlsx │                                     │
│    ⏳ 处理中   │                                     │
│                │                                     │
│  [删除]        │                                     │
└────────────────┴─────────────────────────────────────┘
```

### 5.4 文件预览（通用，所有格式）

点击引用来源后弹出或右侧展开：

| 格式 | 预览方案 | 跳转方式 |
|---|---|---|
| PDF | xxx-ai-frontend 的 PDFViewer | `scrollToPage(page_num)` |
| Word (.docx) | mammoth.js 转 HTML + 高亮 | 按 `paragraph_idx` 滚动 |
| Excel (.xlsx) | SheetJS 转 HTML 表格 | 跳到 sheet + 高亮行 |
| txt | 纯文本 + 高亮 | 按 `char_offset` 滚动 |

### 5.5 管理员面板 `/admin/users`

```
┌─────────────────────────────────────────────┐
│  用户管理                        [+ 新增用户] │
├──────────┬──────────┬────────┬──────────────┤
│ 用户名   │ 角色     │ 状态   │ 操作         │
├──────────┼──────────┼────────┼──────────────┤
│ admin    │ 管理员   │ 启用   │ 重置密码     │
│ user1    │ 普通用户 │ 启用   │ 重置密码 停用│
│ user2    │ 普通用户 │ 停用   │ 重置密码 启用│
└──────────┴──────────┴────────┴──────────────┘
```

功能：新增用户（用户名+初始密码）、停用/启用、重置密码。**不支持删除**（保留数据完整性）。

---

## 6. 认证设计

```
登录请求
  │
  ▼
POST /api/auth/login
  - 验证 username + password（bcrypt 比对）
  - 生成 JWT（payload: { user_id, username, role, exp }）
  - 写入 httpOnly Cookie（secure, sameSite=strict）
  │
  ▼
Next.js Middleware（middleware.ts）
  - 所有 /demo /chat /admin/* 路由检查 Cookie
  - Cookie 无效 → 重定向 /login
  - /admin/* 额外检查 role === 'admin'
  │
  ▼
API Routes（/api/...）
  - 从 Cookie 解析 JWT → 获取 user_id
  - user_id 传给 agent 服务
```

---

## 7. Web ↔ Agent 通信

Web 作为 BFF（Backend for Frontend），所有 agent 调用走服务端：

```
浏览器
  │ fetch /api/chat/stream（携带 Cookie）
  ▼
Next.js API Route（服务端）
  │ 验证 JWT → 提取 user_id
  │ 转发请求到 agent
  ▼
Python FastAPI agent（localhost:8000）
  │ SSE 流式响应
  ▼
Next.js API Route
  │ 透传 SSE 给浏览器
  ▼
浏览器（实时渲染）
```

Agent 地址配置：`AGENT_URL=http://localhost:8000`（环境变量）

---

## 8. 环境变量

### apps/web/.env.local

```
AGENT_URL=http://localhost:8000
JWT_SECRET=your-secret-key-here
DATABASE_PATH=../../data/enterprise_rag.db
```

### apps/agent/.env

```
DATABASE_PATH=../../data/enterprise_rag.db
UPLOAD_DIR=../../data/uploads
CHROMA_DIR=../../data/chroma_db
OPENAI_API_KEY=（从 Mac 钥匙串读取）
MEM0_ENABLED=false
```

---

## 9. 不在本期范围内

- 邮件通知
- 文件版本管理
- 用户自行修改密码的 UI（管理员重置即可）
- 移动端适配
- 国际化
