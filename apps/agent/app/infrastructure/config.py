from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str
    database_url: str = "mysql+pymysql://root:Lyx2020.@localhost:3306/enterprise_rag?charset=utf8mb4"
    upload_dir: str = "../../data/uploads"
    demo_dir: str = "../../data/demo"
    chroma_dir: str = "../../data/chroma_db"
    rerank_score_threshold: float = 0.3

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def resolved_upload_dir(self):
        from pathlib import Path
        p = Path(self.upload_dir).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p

    def resolved_chroma_dir(self):
        from pathlib import Path
        p = Path(self.chroma_dir).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
