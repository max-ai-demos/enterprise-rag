# 企业知识库问答

> 把内部文档变成可对话的知识资产——员工用自然语言提问，AI 从文档中精准检索并给出答案，每条回答都标注原文来源段落，不猜测、不捏造。

**线上体验：** https://rag.luyaxiang.com　｜　账号：`demo / demo1234`

---

## 项目简介

企业内部 RAG（检索增强生成）知识库问答系统。支持上传 PDF、Word、PPT、Excel、TXT 等多种格式文档，系统自动解析、分块、向量化入库。员工通过自然语言多轮对话提问，AI 使用混合检索（向量 + BM25）精准召回相关段落，经 Reranker 重排后由 LLM 流式生成答案，并标注原文来源（支持点击跳转）。低置信度时主动告知"未找到相关内容"，防止幻觉。

---

## 技术栈

- 前端：Next.js 14 / React 18 / TypeScript / Tailwind CSS
- 后端：FastAPI / Python（uv 管理依赖）
- AI：OpenAI API（GPT-4o 答案生成 + text-embedding-3-small 向量嵌入）
- 数据库：MySQL 8（含向量存储）
- 文档解析：PyMuPDF / python-docx / python-pptx / openpyxl
- 检索：LlamaIndex（混合检索框架）
- 其他：Nginx（反向代理，rag.luyaxiang.com）

---

## 主要功能

- 多格式文档上传（PDF / Word / PPT / Excel / TXT，批量支持）
- 自动文档解析、分块（LlamaIndex SentenceSplitter）、向量化入库
- 多轮自然语言对话，AI 记住上下文
- 混合检索：向量检索（语义）+ BM25（关键词）双路召回
- CrossEncoder Reranker 重排序，提升精准度
- 答案来源标注，可点击跳转原文位置
- 置信度控制：低分结果主动告知"文档中未找到明确答案"
- SSE 流式输出，边生成边展示
- 查询改写（query rewriting），提升检索质量
- 对话历史持久化（MySQL）
- 预置演示案例（Demo 模式，秒开）
- 可选 PDF 云解析增强（Datalab / MinerU）

---

## 目录结构

```bash
.
├── apps/
│   ├── web/                          # Next.js 前端（端口 3001）
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (app)/
│   │   │   │   │   ├── chat/page.tsx   # 主对话界面（文档 + 聊天分栏）
│   │   │   │   │   └── demo/page.tsx   # 预置演示案例
│   │   │   │   └── api/
│   │   │   │       ├── agent/          # 代理转发到 FastAPI
│   │   │   │       └── auth/           # JWT 登录 / 登出 / 验证
│   │   │   ├── components/
│   │   │   │   ├── ChatPanel.tsx       # 消息列表 + SSE 流式渲染
│   │   │   │   ├── ViewerPanel.tsx     # 文档预览面板
│   │   │   │   └── FileViewer/         # PDF / Word / Excel 预览组件
│   │   │   └── lib/                    # agent.ts / auth.ts / db.ts
│   │   └── package.json
│   └── agent/                        # FastAPI 后端（端口 8001）
│       ├── app/
│       │   ├── api/
│       │   │   ├── chat.py             # 流式对话端点（SSE）
│       │   │   ├── document.py         # 文档上传 / 列表 / 删除
│       │   │   └── history.py          # 对话历史查询
│       │   ├── db/                     # SQLAlchemy 模型 + Repository
│       │   ├── infrastructure/
│       │   │   ├── config.py           # pydantic-settings 配置
│       │   │   ├── file_storage.py     # 本地文件读写
│       │   │   ├── datalab_client.py   # Datalab PDF 解析（可选）
│       │   │   └── mineru_client.py    # MinerU PDF 解析（可选）
│       │   └── rag/
│       │       ├── ingestion.py        # 文档解析入库主流程
│       │       ├── chunking.py         # 文本分块策略
│       │       ├── pipeline.py         # RAG 查询主流程
│       │       ├── hybrid_retriever.py # 向量 + BM25 混合检索
│       │       ├── reranker.py         # CrossEncoder 重排序
│       │       ├── score_fusion.py     # 双路分数融合
│       │       ├── confidence.py       # 置信度评估
│       │       ├── query_rewriter.py   # 问题改写
│       │       ├── memory.py           # 用户对话记忆
│       │       └── prompt.py           # 系统 Prompt 模板
│       ├── tests/                      # Pytest 测试套件
│       ├── requirements.txt
│       └── main.py
├── data/
│   ├── demo/                         # 预置演示文档
│   └── uploads/                      # 用户上传文件
├── scripts/
│   ├── init.sql                      # 数据库初始化 SQL
│   ├── seed_demo.py                  # 导入演示文档脚本
│   ├── reindex.py                    # 重建向量索引
│   └── dev/
│       ├── start-agent.sh            # 启动后端（生产模式）
│       ├── start-web.sh              # 启动前端（生产模式）
│       ├── start-local-agent.sh      # 启动后端（本地开发模式）
│       └── start-local-web.sh        # 启动前端（本地开发模式）
├── infra/
│   └── nginx/                        # Nginx 配置（rag.luyaxiang.com → 127.0.0.1:3001）
└── README.md
```

---

## 环境变量

### 前端（apps/web/.env.local）

| 变量名 | 说明 | 示例 |
|--------|------|------|
| AGENT_URL | 后端 API 地址 | http://localhost:8001 |
| JWT_SECRET | JWT 签名密钥（与后端一致） | enterprise-rag-secret-2026 |
| DB_HOST | MySQL 主机 | localhost |
| DB_PORT | MySQL 端口 | 3306 |
| DB_USER | MySQL 用户名 | root |
| DB_PASSWORD | MySQL 密码 | your_password |
| DB_NAME | 数据库名 | enterprise_rag |

### 后端（apps/agent/.env）

| 变量名 | 说明 | 示例 |
|--------|------|------|
| OPENAI_API_KEY | OpenAI API Key（生成 + 嵌入） | sk-... |
| DATABASE_URL | MySQL 连接字符串 | mysql+pymysql://root:password@localhost:3306/enterprise_rag?charset=utf8mb4 |
| UPLOAD_DIR | 上传文件目录 | ../../data/uploads |
| DEMO_DIR | 演示文档目录 | ../../data/demo |
| RERANK_SCORE_THRESHOLD | 重排序分数阈值 | 0.3 |
| PDF_PARSER_PROVIDER | PDF 解析器（pymupdf / datalab / mineru） | pymupdf |
| DATALAB_API_KEY | Datalab API Key（可选，增强 PDF 解析） | |
| MINERU_BASE_URL | MinerU 服务地址（可选） | |

---

## 本地开发

```bash
# 创建数据库
mysql -u root -p -e "CREATE DATABASE enterprise_rag CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 安装后端依赖
cd apps/agent
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY 和 DATABASE_URL
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# 安装前端依赖（新开终端）
cd apps/web
cp .env.local.example .env.local
# 编辑 .env.local，填入 JWT_SECRET 和 DB 连接信息
npm install
npm run dev
```

打开 http://localhost:3001

使用本地开发脚本（自动读取 OpenAI Key，自动查找空闲端口）：

```bash
bash scripts/dev/start-local-agent.sh
bash scripts/dev/start-local-web.sh
```

使用生产启动脚本（需先 `npm run build`）：

```bash
bash scripts/dev/start-agent.sh
bash scripts/dev/start-web.sh
```

导入演示文档（可选）：

```bash
# 将文档放入 data/demo/ 目录，然后：
cd apps/agent && python ../../scripts/seed_demo.py
```

---

## 部署

Nginx 配置位于 `infra/nginx/rag-luyaxiang.nginx.conf`，监听 `127.0.0.1:5174`，将 `rag.luyaxiang.com` 反向代理到 `127.0.0.1:3001`。将配置文件复制到 `/Users/mac/.doc-cloud/config/` 后 reload nginx 生效。

---

## 默认账号

RAG 项目使用 MySQL 数据库中的用户表进行认证（非硬编码）。初次部署需通过 `scripts/init.sql` 初始化用户数据。演示环境账号：

| 用户名 | 密码 |
|--------|------|
| demo | demo1234 |
