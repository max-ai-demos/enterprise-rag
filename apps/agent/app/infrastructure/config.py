from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str
    database_path: str = "../../data/enterprise_rag.db"
    upload_dir: str = "../../data/uploads"
    demo_dir: str = "../../data/demo"
    chroma_dir: str = "../../data/chroma_db"
    mem0_enabled: bool = False
    mem0_api_key: str = ""
    rerank_score_threshold: float = 0.3

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    def resolved_database_path(self) -> Path:
        return Path(self.database_path).resolve()

    def resolved_upload_dir(self) -> Path:
        p = Path(self.upload_dir).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p

    def resolved_chroma_dir(self) -> Path:
        p = Path(self.chroma_dir).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
