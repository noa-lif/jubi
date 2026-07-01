"""
Application configuration loaded from environment variables (via .env file).
Uses pydantic-settings for type-safe, validated settings.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./expense_tracker.db"
    SECRET_KEY: str = "change-me-in-production-use-a-long-random-string"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080
    RESEND_API_KEY: str = ""
    FRONTEND_URL: str = "https://jubijubi.com"


# Module-level singleton — import this everywhere
settings = Settings()
