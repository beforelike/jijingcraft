"""Async OpenAI-compatible chat client used by Python Smart Brain agents."""

from __future__ import annotations

import time
from typing import Any

import httpx

from .config import BrainConfig


class LLMClient:
    def __init__(self, cfg: BrainConfig, http: httpx.AsyncClient | None = None) -> None:
        self._cfg = cfg
        self._http = http or httpx.AsyncClient(timeout=cfg.llm_timeout_s)

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float | None = None,
        json_mode: bool = True,
    ) -> dict[str, Any]:
        started_at = time.monotonic()
        body: dict[str, Any] = {
            "model": self._cfg.llm_model,
            "messages": messages,
            "temperature": self._cfg.response_temperature if temperature is None else temperature,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        try:
            response = await self._http.post(
                self._cfg.llm_chat_url,
                headers={
                    "Authorization": f"Bearer {self._cfg.llm_api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            duration_ms = (time.monotonic() - started_at) * 1000
            payload = response.json()
            if response.status_code >= 400:
                error = payload.get("error", {}) if isinstance(payload, dict) else {}
                return {"ok": False, "error": error.get("message") or response.reason_phrase, "durationMs": duration_ms}

            choice = (payload.get("choices") or [{}])[0]
            message = choice.get("message") or {}
            return {
                "ok": True,
                "content": message.get("content") or "",
                "finishReason": choice.get("finish_reason"),
                "usage": payload.get("usage") or {},
                "durationMs": duration_ms,
            }
        except Exception as exc:  # network errors, timeouts, malformed upstream payloads
            duration_ms = (time.monotonic() - started_at) * 1000
            return {"ok": False, "error": str(exc), "durationMs": duration_ms}

    async def aclose(self) -> None:
        await self._http.aclose()
