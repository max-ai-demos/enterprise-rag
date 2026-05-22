# enterprise-rag · 企业知识库问答

> 把内部文档变成可对话的知识资产——员工用自然语言提问，AI 从文档中精准检索并给出答案，每条回答都标注原文来源段落，不猜测、不捏造。

**线上体验：** https://rag.luyaxiang.com　｜　账号：`demo / demo1234`

**参考报价：3.6–6 万**　｜　**实现难度：中**　｜　**市场需求：★★★★★**

---

## 解决什么痛点

**痛点 1：知识沉淀在文档里，找不到、用不上。**
企业积累了大量 PDF、Word、PPT，但员工遇到问题时要么翻文件夹半小时，要么直接问同事——后者打断别人工作，前者效率极低。文档越多，问题越严重。

**痛点 2：新员工上手慢，老员工被反复打扰。**
同样的问题被不同人问 100 遍。有经验的员工要花大量时间回答重复问题，而不是做更有价值的工作。

**痛点 3：知识更新后，旧答案仍在流传。**
靠口耳相传的知识无法保证一致性。文档更新后员工不知道，旧信息继续被引用，导致决策出错。

**痛点 4：通用 AI 不了解公司私有知识。**
ChatGPT 等通用 AI 不知道公司的产品规格、内部流程、客户案例。RAG 让 AI 读懂公司私有文档后再回答，而不是胡乱编造。

---

## 目标用户

| 角色 | 使用场景 |
|------|---------|
| 全体员工 | 查询公司政策、流程规范、产品规格 |
| 新员工 | 快速了解公司制度，减少对老员工的依赖 |
| 客服团队 | 实时查询产品手册，给客户精准回答 |
| 销售 | 快速找到报价标准、技术规格、行业案例 |
| 合规团队 | 检索法规文件，确认条款细节 |

---

## 演示流程

```
Step 1  上传文档（支持批量）
        格式：PDF / Word / PPT / TXT
        系统自动解析 → 分块 → 向量化 → 入库
        进度实时可见

Step 2  自然语言提问（多轮对话）
        "我们公司的年假政策是什么？"
        "产品 A 和产品 B 的主要区别是什么？"
        "第3季度的销售目标是多少？"
        "上次培训中提到的合规要求有哪几条？"

Step 3  获取答案 + 来源标注
        AI 给出精准回答，并高亮显示原文段落
        置信度低时主动告知："文档中没有明确提及"
        支持追问，AI 记住上下文

Step 4  查看案例（预置演示数据，秒开）
        Tab「查看案例」：直接展示预跑的问答结果
        Tab「上传体验」：用户上传自己的文档实时测试
```

---

## 核心功能

- **多格式支持**：PDF、Word、DOCX、PPT、TXT，自动识别编码和语言
- **混合检索**：向量检索（语义）+ BM25（关键词）双路召回，召回率比单路高 30%+
- **重排序**：CrossEncoder reranker 对召回结果重新评分，精准度显著提升
- **答案溯源**：每条回答标注来源段落，用户可点击跳转原文位置
- **置信度控制**：低分结果不强行回答，主动告知"文档中未找到明确答案"
- **多轮对话**：会话历史存储在 MySQL，支持追问和上下文理解
- **流式输出**：SSE 实时推送，用户看到字逐渐出现，体验流畅
- **可选 Web 搜索**：Tavily 增强，超出文档范围时可搜索外部信息

---

## 技术架构

```
用户提问
    │
    ▼
Next.js Web（Port 3001）
    │ SSE 流式输出
    ▼
FastAPI Agent（Port 8001）
    │
    ├── Query Rewriter        ← 将口语问题改写为检索友好的关键词
    ├── Hybrid Retriever      ← 混合检索（向量 + 关键词融合）
    │       ├── Vector Search   ← MySQL 余弦相似度
    │       └── BM25 Search     ← 关键词全文检索
    ├── Reranker              ← CrossEncoder 对候选块重排序
    ├── Score Fusion          ← 向量分数 + Reranker 分数融合
    ├── Confidence Check      ← 低置信度时拒绝回答，防止幻觉
    └── LLM                   ← 流式生成答案，引用原文段落

文档摄入（异步后台）：
PDF/Word/PPT → 文本提取（PyMuPDF）→ 分块（LlamaIndex SentenceSplitter）
  → OpenAI text-embedding-3-small → MySQL 向量存储
```

---

## 技术栈

| 层次 | 技术 | 说明 |
|------|------|------|
| AI 生成 | Claude Sonnet（Anthropic） | 流式答案生成，200K 上下文 |
| 向量嵌入 | OpenAI text-embedding-3-small | 文本向量化（1536 维）|
| 向量存储 | MySQL VECTOR(1536) | 余弦相似度检索 |
| 重排序 | CrossEncoder (BAAI/bge-reranker) | 本地推理，候选块精排 |
| 后端框架 | FastAPI 0.115+ | 异步 HTTP + SSE |
| ORM | SQLAlchemy 2.0+ | MySQL 数据库操作 |
| 文档解析 | PyMuPDF / python-docx / python-pptx | 多格式文本提取 |
| 分块策略 | LlamaIndex SentenceSplitter | 语义感知分块 |
| 前端框架 | Next.js 14 (App Router) | SSE 流式渲染 |
| UI 样式 | Tailwind CSS 3.x | 组件样式 |
| 包管理 | uv (Python) / pnpm (JS) | 依赖管理 |
| 数据库 | MySQL 8.0+ | 文档元数据 + 向量 + 会话历史 |

---

## 项目结构

```
enterprise-rag/
├── apps/
│   ├── agent/                          # Python FastAPI 后端
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── chat.py             # 流式对话端点（SSE）
│   │   │   │   ├── document.py         # 文档上传 / 列表 / 删除
│   │   │   │   └── history.py          # 对话历史查询
│   │   │   ├── db/
│   │   │   │   ├── database.py         # SQLAlchemy 引擎 + 会话
│   │   │   │   ├── models.py           # Document / ChatSession / ChatMessage
│   │   │   │   └── repository.py       # 数据库操作封装
│   │   │   ├── infrastructure/
│   │   │   │   ├── config.py           # 环境变量（pydantic-settings）
│   │   │   │   ├── file_storage.py     # 本地文件读写
│   │   │   │   └── web_search.py       # Tavily 搜索封装（可选）
│   │   │   └── rag/
│   │   │       ├── ingestion.py        # 文档解析入库主流程
│   │   │       ├── chunking.py         # 文本分块策略
│   │   │       ├── pipeline.py         # RAG 查询主流程（检索→重排→生成）
│   │   │       ├── hybrid_retriever.py # 向量 + BM25 混合检索
│   │   │       ├── reranker.py         # CrossEncoder 重排序
│   │   │       ├── score_fusion.py     # 双路分数融合
│   │   │       ├── confidence.py       # 置信度评估（低分拒答）
│   │   │       ├── query_rewriter.py   # 问题改写（提升检索质量）
│   │   │       └── prompt.py           # 系统 Prompt 模板
│   │   ├── tests/                      # Pytest 测试套件
│   │   ├── main.py                     # FastAPI 入口，挂载路由
│   │   ├── pyproject.toml
│   │   └── .env.example                # 环境变量模板
│   └── web/                            # Next.js 14 前端
│       └── src/
│           ├── app/
│           │   ├── (app)/
│           │   │   ├── chat/page.tsx   # 主对话界面
│           │   │   └── demo/page.tsx   # 预置演示案例
│           │   └── api/
│           │       ├── agent/          # 代理转发到 FastAPI
│           │       └── auth/           # JWT 登录 / 登出 / 验证
│           └── components/
│               ├── ChatPanel.tsx       # 消息列表 + 流式渲染
│               └── FileViewer/         # PDF 预览组件
└── scripts/
    └── dev/
        ├── start-agent.sh              # 启动后端
        └── start-web.sh                # 启动前端
```

---

## API 端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/auth/login` | 用户登录，返回 JWT |
| POST | `/api/v1/documents/upload` | 上传文档（multipart，后台异步入库）|
| GET  | `/api/v1/documents/` | 列出所有已上传文档 |
| DELETE | `/api/v1/documents/{id}` | 删除文档及其向量数据 |
| POST | `/api/v1/chat/` | 发起流式对话（SSE，返回 text/event-stream）|
| GET  | `/api/v1/chat/sessions` | 列出历史会话 |
| GET  | `/api/v1/chat/sessions/{id}/messages` | 获取某会话的完整消息 |
| GET  | `/api/v1/health` | 健康检查 |

---

## 环境变量

### apps/agent/.env

| 变量 | 必填 | 说明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | ✅ | Claude API 密钥（答案生成）|
| `OPENAI_API_KEY` | ✅ | OpenAI API 密钥（向量嵌入）|
| `DATABASE_URL` | ✅ | MySQL 连接串，如 `mysql+pymysql://root:pass@localhost:3306/enterprise_rag` |
| `JWT_SECRET` | ✅ | JWT 签名密钥，与前端保持一致 |
| `TAVILY_API_KEY` | ❌ | 可选，联网搜索增强 |
| `UPLOAD_DIR` | ❌ | 上传文件目录，默认 `uploads` |

### apps/web/.env.local

| 变量 | 必填 | 说明 |
|------|------|------|
| `JWT_SECRET` | ✅ | 与后端保持一致 |
| `AGENT_URL` | ✅ | 后端地址，本地开发为 `http://localhost:8001` |
| `DB_HOST` | ✅ | MySQL 主机 |
| `DB_PORT` | ✅ | MySQL 端口，默认 `3306` |
| `DB_USER` | ✅ | MySQL 用户名 |
| `DB_PASSWORD` | ✅ | MySQL 密码 |
| `DB_NAME` | ✅ | 数据库名，`enterprise_rag` |

---

## 快速启动

### 前置条件

- Python 3.11+
- Node.js 18+ / pnpm 10+
- MySQL 8.0+
- [uv](https://github.com/astral-sh/uv)（Python 包管理）

### 1. 创建数据库

```sql
CREATE DATABASE enterprise_rag CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. 启动后端

```bash
cd apps/agent
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY、OPENAI_API_KEY 和 DATABASE_URL
uv venv && source .venv/bin/activate
uv pip install -e .
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

### 3. 启动前端

```bash
cd apps/web
cp .env.local.example .env.local
# 编辑 .env.local，填入 JWT_SECRET 和数据库连接信息
pnpm install
pnpm dev
```

打开 http://localhost:3001，账号：`demo / demo1234`

### 使用 start 脚本（生产模式）

```bash
# 构建前端
pnpm --prefix apps/web build

# 启动后端
bash scripts/dev/start-agent.sh

# 启动前端
bash scripts/dev/start-web.sh
```

---

## 常见问题

**Q: 上传文档后很久没有响应？**
文档入库是异步处理，大文件（100 页 PDF）需要 1–3 分钟。可查看 agent 日志确认进度。

**Q: 回答说"文档中没有找到相关内容"？**
检索置信度低于阈值时会拒绝回答，可尝试换一种问法，或确认该内容是否在已上传的文档中。

**Q: MySQL VECTOR 类型不支持？**
需要 MySQL 8.0.32+ 或 MySQL 9.x。低版本请升级，或联系我们提供 pgvector 迁移方案。
