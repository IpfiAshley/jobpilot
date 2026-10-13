from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    database_url: str = "sqlite:///./data/jobpilot.db"
    adzuna_app_id: str = ""
    adzuna_app_key: str = ""
    adzuna_results_per_query: int = 50
    adzuna_max_pages: int = 2
    rss_feed_urls: str = ""
    ingestion_token: str = ""
    http_timeout_seconds: float = 20.0
    user_agent: str = "JobPilot/0.1 (+contact: admin@example.com)"
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"

    @property
    def rss_urls(self) -> list[str]:
        return [url.strip() for url in self.rss_feed_urls.split(",") if url.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

