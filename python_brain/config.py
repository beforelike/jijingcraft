"""Configuration for the Python Smart Brain service."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH, override=False)


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _api_key_missing(api_key: str) -> bool:
    normalized = api_key.strip().lower()
    return not normalized or "your-api-key" in normalized or normalized in {"placeholder", "changeme"}


class BrainConfig:
    def __init__(self) -> None:
        self.host = os.getenv("BRAIN_HOST", "127.0.0.1")
        self.port = _int("BRAIN_PORT", 3001)

        raw_base_url = (os.getenv("LLM_BASE_URL") or os.getenv("BASE_URL") or "https://api.openai.com/v1").rstrip("/")
        self.llm_base_url = raw_base_url
        self.llm_chat_url = raw_base_url if raw_base_url.endswith("/chat/completions") else f"{raw_base_url}/chat/completions"
        self.llm_api_key = os.getenv("LLM_API_KEY") or os.getenv("API_KEY") or ""
        self.llm_model = os.getenv("LLM_MODEL") or os.getenv("MODEL") or "gpt-4o-mini"
        self.llm_timeout_s = max(1.0, _int("LLM_TIMEOUT_MS", 60000) / 1000)

        self.parallel_agents = _bool("BRAIN_PARALLEL_AGENTS", True)
        self.general_agent_enabled = _bool("BRAIN_GENERAL_AGENT_ENABLED", True)
        self.agent_timeout_s = max(1.0, _int("BRAIN_AGENT_TIMEOUT_MS", 45000) / 1000)
        self.max_trees_per_response = max(1, min(_int("BRAIN_MAX_TREES", 4), 8))
        self.max_context_chars = max(2000, _int("BRAIN_MAX_CONTEXT_CHARS", 12000))
        self.response_temperature = float(os.getenv("BRAIN_TEMPERATURE", "0"))

    @property
    def llm_enabled(self) -> bool:
        return not _api_key_missing(self.llm_api_key)

    @property
    def public_config(self) -> dict[str, object]:
        return {
            "model": self.llm_model,
            "baseUrl": self.llm_base_url,
            "llmEnabled": self.llm_enabled,
            "parallelAgents": self.parallel_agents,
            "generalAgentEnabled": self.general_agent_enabled,
            "agentTimeoutMs": int(self.agent_timeout_s * 1000),
            "maxTreesPerResponse": self.max_trees_per_response,
        }
