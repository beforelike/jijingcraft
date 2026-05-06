"""
Configuration loaded from environment variables / .env file.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Try to load .env from project root (one level up from python_brain/)
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=_env_path, override=False)


class BrainConfig:
    # LLM
    llm_api_key: str
    llm_base_url: str
    llm_model: str
    llm_timeout_s: float
    llm_chat_url: str

    # Server
    host: str
    port: int

    # Feature flags
    parallel_agents: bool  # run agents concurrently (default True)
    max_trees_per_response: int

    def __init__(self) -> None:
        self.llm_api_key = os.getenv("LLM_API_KEY") or os.getenv("API_KEY") or ""
        raw_base = (
            os.getenv("LLM_BASE_URL")
            or os.getenv("BASE_URL")
            or "https://api.openai.com/v1"
        ).rstrip("/")
        self.llm_base_url = raw_base
        self.llm_chat_url = (
            raw_base
            if raw_base.endswith("/chat/completions")
            else f"{raw_base}/chat/completions"
        )
        self.llm_model = os.getenv("LLM_MODEL") or "gpt-4o-mini"
        self.llm_timeout_s = float(os.getenv("LLM_TIMEOUT_MS", "60000")) / 1000

        self.host = os.getenv("BRAIN_HOST", "127.0.0.1")
        self.port = int(os.getenv("BRAIN_PORT", "3001"))

        self.parallel_agents = os.getenv("BRAIN_PARALLEL_AGENTS", "true").lower() != "false"
        self.max_trees_per_response = int(os.getenv("BRAIN_MAX_TREES", "4"))

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key) and self.llm_api_key not in (
            "your-api-key-here",
            "placeholder",
            "",
        )
