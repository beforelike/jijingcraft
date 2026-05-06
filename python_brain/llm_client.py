"""
Async LLM client using httpx.
Wraps any OpenAI-compatible /v1/chat/completions endpoint.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from .config import BrainConfig


class LLMError(Exception):
    pass


class LLMClient:
    def __init__(self, cfg: BrainConfig, http: httpx.AsyncClient | None = None):
        self._cfg = cfg
        self._http = http or httpx.AsyncClient(timeout=cfg.llm_timeout_s)

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
    ) -> dict[str, Any]:
        """
        Single async chat completion call.
        Returns a normalised dict:
          {ok, content, tool_calls, finish_reason, duration_ms, error?}
        """
        t0 = time.monotonic()
        body: dict[str, Any] = {
            "model": self._cfg.llm_model,
            "messages": messages,
            "temperature": temperature,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"

        try:
            resp = await self._http.post(
                self._cfg.llm_chat_url,
                headers={
                    "Authorization": f"Bearer {self._cfg.llm_api_key}",
                    "Content-Type": "application/json",
                },
                content=json.dumps(body),
            )
            dur_ms = (time.monotonic() - t0) * 1000
            data = resp.json()

            if resp.status_code != 200:
                return {
                    "ok": False,
                    "error": data.get("error", {}).get("message", resp.reason_phrase),
                    "duration_ms": dur_ms,
                }

            msg = data.get("choices", [{}])[0].get("message", {})
            raw_calls = msg.get("tool_calls") or []
            tool_calls = [
                {
                    "id": c.get("id"),
                    "name": c.get("function", {}).get("name"),
                    "arguments": c.get("function", {}).get("arguments", "{}"),
                }
                for c in raw_calls
            ]
            return {
                "ok": True,
                "content": msg.get("content") or "",
                "tool_calls": tool_calls,
                "finish_reason": data.get("choices", [{}])[0].get("finish_reason"),
                "duration_ms": dur_ms,
            }
        except Exception as exc:  # network errors, timeouts, etc.
            dur_ms = (time.monotonic() - t0) * 1000
            return {"ok": False, "error": str(exc), "duration_ms": dur_ms}

    async def aclose(self) -> None:
        await self._http.aclose()
