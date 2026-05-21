# enterprise-rag · 企业知识库问答

> 把内部文档变成可对话的知识资产——员工用自然语言提问，AI 从文档中精准检索并给出答案，每条回答都标注原文来源段落，不猜测、不捏造。

**参考报价：3.6–6 万**｜**实现难度：中**｜**市场需求：★★★★★**

**线上地址：** https://rag.luyaxiang.com

---

## 解决什么痛点

**痛点 1：知识沉淀在文档里，找不到、用不上。**
企业积累了大量 PDF、Word、PPT，但员工遇到问题时要么翻文件夹半小时，要么直接问同事——后者打断别人工作，前者效率极低。文档越多，问题越严重。

**痛点 2：新员工上手慢，老员工被反复打扰。**
同样的问题被不同人问 100 遍。有经验的员工要花大量时间回答重复问题，而不是做更有价值的工作。

**痛点 3：知识更新后，旧答案仍在流传。**
靠口耳相传的知识无法保证一致性。文档更新后员工不知道，旧信息继续被引用，导致决策出错。

**痛点 4：外部系统的知识 AI 不知道。**
ChatGPT 等通用 AI 不知道公司的产品规格、内部流程、客户案例。RAG 让 AI 读懂公司私有文档后再回答。

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
    │
    ├── Hybrid Retriever      ← 混合检索（向量 + 关键词融合）
    │       │
    │       ├── Vector Search   ← MySQL VECTOR(1536) 余弦相似度
    │       └── BM25 Search     ← 关键词全文检索
    │
    ├── Reranker              ← CrossEncoder 对候选块重排序
    │
    ├── Score Fusion          ← 向量分数 + Reranker 分数融合
    │
    ├── Confidence Check      ← 低置信度时拒绝回答，防止幻觉
    │
    └── Claude claude-sonnet-4-6  ← 流式生成答案，引用原文段落

文档摄入流程（异步后台）：
PDF/Word/PPT → 文本提取（PyMuPDF）→ 分块（LlamaIndex SentenceSplitter）
  → OpenAI text-embedding-3-small → MySQL VECTOR(1536) 存储
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

## 项目结构

```
enterprise-rag/
├── apps/
│   ├── agent/                          # Python FastAPI 后端
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── chat.py             # 流式对话端点（SSE）
│   │   │   │   ├── document.py         # 文档上传/列表/删除
│   │   │   │   └── history.py          # 对话历史查询
│   │   │   ├── db/
│   │   │   │   ├── database.py         # SQLAlchemy 引擎 + 会话
│   │   │   │   ├── models.py           # Document / ChatSession / ChatMessage 模型
│   │   │   │   └── repository.py       # 数据库操作封装
│   │   │   ├── infrastructure/
│   │   │   │   ├── config.py           # 环境变量（pydantic-settings）
│   │   │   │   ├── file_storage.py     # 本地文件读写
│   │   │   │   ├── web_search.py       # Tavily 搜索封装
│   │   │   │   ├── datalab_client.py   # 可选：云端 OCR（Datalab）
│   │   │   │   └── mineru_client.py    # 可选：自托管 OCR（MinerU）
│   │   │   └── rag/
│   │   │       ├── ingestion.py        # 文档解析入库主流程
│   │   │       ├── chunking.py         # 文本分块策略（sentence / smart）
│   │   │       ├── pipeline.py         # RAG 查询主流程（检索→重排→生成）
│   │   │       ├── hybrid_retriever.py # 向量 + BM25 混合检索
│   │   │       ├── reranker.py         # CrossEncoder 重排序
│   │   │       ├── score_fusion.py     # 双路分数融合
│   │   │       ├── confidence.py       # 置信度评估（低分拒答）
│   │   │       ├── query_rewriter.py   # 问题改写（提升检索质量）
│   │   │       ├── prompt.py           # 系统 Prompt 模板
│   │   │       ├── summarizer.py       # 长上下文摘要（超出窗口时）
│   │   │       ├── memory.py           # 会话记忆（Mem0 可选）
│   │   │       └── pdf_utils.py        # PDF 特殊处理工具
│   │   ├── tests/                      # Pytest 测试套件
│   │   ├── main.py                     # FastAPI 入口，挂载路由
│   │   ├── reingest_all.py             # 重新向量化所有已上传文档
│   │   ├── pyproject.toml
│   │   ├── .env.example                # 环境变量模板（提交）
│   │   └── .env                        # 真实密钥（不提交）
│   └── web/                            # Next.js 14 前端
│       └── src/
│           ├── app/
│           │   ├── (app)/
│           │   │   ├── chat/page.tsx   # 主对话界面
│           │   │   └── demo/page.tsx   # 预置演示案例
│           │   └── api/
│           │       ├── agent/[...path] # 代理转发到 FastAPI
│           │       └── auth/           # JWT 登录/登出/验证
│           └── components/
│               ├── ChatPanel.tsx       # 消息列表 + 流式渲染
│               └── FileViewer/         # PDF 预览组件
```

---

## Tech Stack

| 层次 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 大模型 | Claude claude-sonnet-4-6 | 最新 | 答案生成，200K context window |
| 向量嵌入 | OpenAI text-embedding-3-small | 最新 | 文本向量化（1536 维）|
| 向量存储 | MySQL VECTOR(1536) | MySQL 9.x | 余弦相似度检索 |
| 重排序 | CrossEncoder（BAAI/bge-reranker） | 本地 | 候选块精排 |
| 后端框架 | FastAPI | 0.115+ | 异步 HTTP + SSE |
| ORM | SQLAlchemy | 2.0+ | MySQL 数据库操作 |
| 文档解析 | PyMuPDF / python-docx / python-pptx | 最新 | 多格式文本提取 |
| 分块策略 | LlamaIndex SentenceSplitter | 最新 | 语义感知分块 |
| 前端框架 | Next.js 14 | App Router | SSE 流式渲染 |
| UI 样式 | Tailwind CSS | 3.x | 组件样式 |
| 包管理 | uv (Python) / pnpm (JS) | 最新 | 依赖管理 |
| 数据库 | MySQL | 8.0+ / 9.x | 文档元数据 + 向量 + 会话历史 |

---

## API 端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/documents/upload` | 上传文档（multipart，后台异步入库）|
| GET | `/api/v1/documents/` | 列出所有已上传文档 |
| DELETE | `/api/v1/documents/{id}` | 删除文档及其向量数据 |
| POST | `/api/v1/chat/` | 发起流式对话（SSE，返回 text/event-stream）|
| GET | `/api/v1/chat/sessions` | 列出历史会话 |
| GET | `/api/v1/chat/sessions/{id}/messages` | 获取某会话的完整消息 |
| GET | `/api/v1/health` | 健康检查 |

---

## 快速启动

```bash
# 1. 建库
mysql -u root -p -e "CREATE DATABASE enterprise_rag CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. 后端
cd apps/agent
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY 和 OPENAI_API_KEY
uv venv && source .venv/bin/activate
uv pip install -e .
uvicorn main:app --port 8001 --reload

# 3. 前端（新终端）
cd apps/web
cp .env.local.example .env.local
# 编辑 .env.local，填入 JWT_SECRET（和 agent .env 保持一致）
pnpm install && pnpm dev --port 3001
```

打开 http://localhost:3001，账号：`demo / demo1234`

**线上地址：** https://rag.luyaxiang.com

