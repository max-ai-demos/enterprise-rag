from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str
    jwt_secret: str = "enterprise-demo-shared-secret-2026"
    rag_service_url: str = ""
    database_url: str = "mysql+pymysql://root:Lyx2020.@localhost:3306/enterprise_rag?charset=utf8mb4"
    upload_dir: str = "../../data/uploads"
    demo_dir: str = "../../data/demo"
    rerank_score_threshold: float = 0.3

    # --- PDF parser provider ---
    # "pymupdf" (default, no extra config needed) | "datalab" | "mineru"
    # Set to "datalab" or "mineru" only after supplying the corresponding API key/URL below.
    pdf_parser_provider: str = "pymupdf"

    # --- Datalab (Marker) cloud OCR — https://www.datalab.to ---
    # 1. 注册 Datalab 账号，获取 API Key
    # 2. 设置 DATALAB_API_KEY=<your-key>，并将 PDF_PARSER_PROVIDER 改为 "datalab"
    datalab_api_key: str = ""
    datalab_base_url: str = "https://www.datalab.to"
    datalab_output_format: str = "json"
    datalab_use_llm: bool = False
    datalab_force_ocr: bool = False
    datalab_max_file_size_mb: int = 50
    datalab_max_poll_seconds: int = 300
    datalab_poll_interval: int = 5

    # --- MinerU self-hosted PDF parser — https://github.com/opendatalab/MinerU ---
    # 1. 自行部署 MinerU 服务
    # 2. 设置 MINERU_BASE_URL=http://<host>:<port>，并将 PDF_PARSER_PROVIDER 改为 "mineru"
    mineru_base_url: str = ""

    # --- Score Fusion（reranker 分数 + 向量 cosine 融合）---
    # alpha=1.0（默认）= 纯 reranker 分数，不融合
    # alpha=0.7 = 推荐融合值，reranker 主导 + cosine 辅助
    # 将 RERANKER_ALPHA 改为 0.0~1.0 之间的值即可激活
    reranker_alpha: float = 1.0

    # --- Jina Reranker v2（跨编码器，非 LLM 打分）--- https://jina.ai ---
    # 1. 注册 Jina AI 账号，获取 API Key（每月 1M tokens 免费）
    # 2. 设置 JINA_API_KEY=<your-key>
    # 无 Key 时自动降级为 score 排序，不影响功能
    jina_api_key: str = ""

    # --- Chunking 策略 ---
    # "sentence"（默认）= LlamaIndex SentenceSplitter，通用文档
    # "smart" = 段落优先、句子兜底的 SmartChunker，适合合同/规章
    # 修改后需重新运行 reingest_all.py 使文档生效
    chunk_strategy: str = "sentence"
    smart_chunk_target_size: int = 400
    smart_chunk_min_size: int = 100

    # --- Web 搜索增强（Tavily）— https://tavily.com ---
    # 1. 注册 Tavily 账号，获取 API Key
    # 2. 设置 TAVILY_API_KEY=<your-key>
    # 3. 在 ChatRequest 中传 use_web_search=true，或设置 WEB_SEARCH_ENABLED=true 全局开启
    tavily_api_key: str = ""
    tavily_max_results: int = 5
    tavily_search_depth: str = "basic"  # "basic" | "advanced"
    tavily_search_timeout: int = 10
    web_search_enabled: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def resolved_upload_dir(self):
        from pathlib import Path
        p = Path(self.upload_dir).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
