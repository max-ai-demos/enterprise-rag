# Enterprise RAG Agent — 系统设计文档

**日期**：2026-05-20  
**状态**：草稿，待用户确认  
**目标评分**：8/10（agent 能力维度）

---

## 1. 项目定位

企业知识库问答系统（RAG Demo）。用户上传企业文档（PDF、Word、Excel、纯文本），通过自然语言提问，AI 从文档中检索相关内容并给出有据可查的答案，支持原文跳转。

**定位**：Demo 先行，架构支持后续扩展为生产产品。

---

## 2. 系统边界

```
┌─────────────────────────────────────────────┐
│              apps/web (Next.js)              │
│  - 文件上传 UI                               │
│  - 对话界面（流式输出）                       │
│  - 原文跳转（点击引用跳到对应页/段）           │
│  - 用户认证（web 层负责，生成 user_id）        │
└───────────────┬─────────────────────────────┘
                │ HTTP / SSE
┌───────────────▼─────────────────────────────┐
│           apps/agent (Python)               │  ← 本文设计范围
│  - 文档摄入 API                              │
│  - RAG 问答 API（流式）                      │
│  - 对话历史 API                              │
└─────────────────────────────────────────────┘
```

**本文只设计 `apps/agent`**，web 层另行设计。

---

## 3. 技术栈

| 层 | 技术 | 选型理由 |
|---|---|---|
| API 框架 | FastAPI + uvicorn | 异步、流式支持好 |
| RAG 框架 | LlamaIndex | 专为文档 RAG 设计，原生 SourceNode 支持原文引用 |
| 向量数据库 | ChromaDB（本地持久化） | 零配置，demo 阶段无需云服务 |
| 关系数据库 | SQLite（SQLAlchemy ORM） | 单文件，迁移 MySQL 只改连接串 |
| LLM | OpenAI GPT-4o | 已有 API Key |
| 跨会话记忆 | Mem0（可选，feature flag 控制） | 按需启用 |
| 文档解析 | pypdf / python-docx / openpyxl | 纯本地，无外部服务依赖 |

---

## 4. 本地目录结构

```
apps/agent/
  app/
    api/               ← FastAPI 路由
      document.py      ← 文件上传、列表、删除
      chat.py          ← 问答（流式 SSE）
      history.py       ← 对话历史
    rag/
      pipeline.py      ← LlamaIndex RAG 主流程
      ingestion.py     ← 文档解析 + 向量化
      query_rewriter.py← 查询改写
      hybrid_retriever.py ← 混合检索（BM25 + 向量）
      reranker.py      ← 重排序
      prompt.py        ← Prompt 模板
    memory/
      mem0_service.py  ← Mem0 封装（可选）
    db/
      models.py        ← SQLAlchemy 模型
      repository.py    ← 数据访问层
    infrastructure/
      config.py        ← 配置（读环境变量）
      openai_client.py ← OpenAI 封装
  uploads/             ← 原始文件存储（按 user_id 分目录）
  chroma_db/           ← ChromaDB 持久化目录
  app.db               ← SQLite 数据库文件
  main.py              ← 启动入口
  requirements.txt
```

---

## 5. 数据模型

### 5.1 documents 表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | VARCHAR | 上传者（web 层传入） |
| filename | VARCHAR | 原始文件名 |
| file_path | VARCHAR | 本地存储路径 |
| file_type | VARCHAR | pdf / docx / xlsx / txt |
| status | VARCHAR | pending / processing / ready / failed |
| chunk_count | INTEGER | 切块数量 |
| created_at | DATETIME | 上传时间 |
| updated_at | DATETIME | 最后更新时间 |

### 5.2 sessions 表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | session_id，主键 |
| user_id | VARCHAR | 所属用户 |
| title | VARCHAR | 对话标题（取首问题前 30 字） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 最后活跃时间 |

### 5.3 messages 表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| session_id | UUID | 所属 session |
| role | VARCHAR | user / assistant |
| content | TEXT | 消息内容 |
| sources | JSON | 引用来源列表（见下） |
| created_at | DATETIME | 时间 |

**sources 结构**（assistant 消息携带）：
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

## 6. RAG Pipeline

### 6.1 文档摄入流程

```
上传文件
  │
  ├─ PDF    → pypdf 按页提取文本 + 页码元数据
  ├─ Word   → python-docx 按段落提取 + 段落序号元数据
  ├─ Excel  → openpyxl 按 sheet/行提取 + sheet+行号元数据
  └─ txt    → 直接读取
  │
  ▼
LlamaIndex 语义分块（chunk_size=512, overlap=64）
  │
  ▼
每个 chunk 携带 metadata：
  { document_id, filename, file_type,
    page_num / paragraph_idx / sheet+row,
    chunk_index }
  │
  ├─ 向量化 → ChromaDB
  └─ BM25 索引 → LlamaIndex BM25Retriever（本地）
  │
  ▼
documents.status → "ready"
```

### 6.2 问答流程（8分能力）

```
用户提问 (query, user_id, session_id, document_ids?)
  │
  ▼
① 查询改写（Query Rewriting）
   - 取最近 3 轮对话历史
   - LLM 将上下文相关的模糊问题改写为独立完整的查询
   - 示例："上面说的截止日期是几号" → "合同付款截止日期"
  │
  ▼
② 混合检索（Hybrid Retrieval）
   - 向量检索（top 10）+ BM25 检索（top 10）
   - Reciprocal Rank Fusion 融合得分
   - 合并去重，取 top 15
  │
  ▼
③ 重排序（Reranking）
   - 使用 LlamaIndex LLMRerank（复用 OpenAI Key，无需额外服务）
   - 取 top 5 最相关 chunks
  │
  ▼
④ 置信度检查（"不知道"防线）
   - 最高分 chunk score < 阈值（默认 0.3）
   - → 直接返回："文档中未找到与该问题相关的内容"
  │
  ▼
⑤ Prompt 构建
   - System：你是企业知识库助手，只基于提供的文档内容回答，
             不得推断或编造，无法确认时明确说明
   - Context：top 5 chunks（含来源标注 [来源1] [来源2]）
   - Mem0 记忆（如启用）
   - 对话历史（最近 6 轮）
   - 用户问题
  │
  ▼
⑥ LLM 流式生成（GPT-4o）
  │
  ▼
⑦ 流式 SSE 输出
   start event:  { sources: [...], session_id }
   delta events: { content: "..." }
   end event:    { answer: "...", sources: [...] }
  │
  ▼
⑧ 持久化
   - messages 表存 Q&A + sources
   - Mem0 异步写入（如启用）
```

---

## 7. API 设计

### 7.1 文档管理

```
POST   /documents/upload
       Body: multipart/form-data { file, user_id }
       Response: { document_id, filename, status: "processing" }

GET    /documents?user_id=xxx
       Response: [{ document_id, filename, status, created_at, chunk_count }]

DELETE /documents/{document_id}
       删除文件、向量、数据库记录
```

### 7.2 问答

```
POST   /chat/stream
       Body: {
         query: string,
         user_id: string,
         session_id: string | null,   // null = 新建 session
         document_ids: string[] | null // null = 查询该用户所有文档
       }
       Response: SSE stream
         data: {"type":"start","session_id":"...","sources":[...]}
         data: {"type":"delta","content":"..."}
         data: {"type":"end","answer":"...","sources":[...]}
         data: {"type":"error","message":"..."}
```

### 7.3 对话历史

```
GET    /sessions?user_id=xxx
       Response: [{ session_id, title, created_at, updated_at }]

GET    /sessions/{session_id}/messages
       Response: [{ role, content, sources, created_at }]

DELETE /sessions/{session_id}
```

---

## 8. 原文跳转实现

每个 chunk 的 metadata 存储位置信息，API 在 sources 里返回：

| 文件类型 | 跳转字段 | 前端行为 |
|---|---|---|
| PDF | `page_num` | 用 PDF.js 跳到对应页 |
| Word | `paragraph_idx` | 高亮对应段落（需前端实现） |
| Excel | `sheet_name` + `row_start` + `row_end` | 跳到对应 sheet 行 |
| txt | `char_offset` | 滚动到对应位置 |

---

## 9. 配置项（环境变量）

```
OPENAI_API_KEY          # OpenAI API Key
UPLOAD_DIR              # 文件存储目录，默认 ./uploads
CHROMA_DIR              # ChromaDB 目录，默认 ./chroma_db
DATABASE_URL            # SQLite: sqlite:///./app.db
                        # 生产: mysql+pymysql://...
MEM0_API_KEY            # Mem0 Key（可选）
MEM0_ENABLED            # true/false，默认 false
RERANK_SCORE_THRESHOLD  # 置信度阈值，默认 0.3
```

---

## 10. 不在本期范围内

- 用户认证（由 web 层处理）
- 多租户隔离（后期扩展）
- 安全性、限流、压测
- 图片/表格内容的视觉理解（OCR）
- 文档版本管理
