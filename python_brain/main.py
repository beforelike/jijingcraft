"""FastAPI entry point for the Python Smart Brain service."""

from __future__ import annotations

import contextlib
import logging
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

try:
    from .langchain_smart.brain import LangChainSmartBrain
    _LANGCHAIN_IMPORT_ERROR: Exception | None = None
except ModuleNotFoundError as exc:
    LangChainSmartBrain = None  # type: ignore[assignment]
    _LANGCHAIN_IMPORT_ERROR = exc

from .brain import SmartBrain
from .config import BrainConfig
from .llm_client import LLMClient
from .models import BrainRequest, PlanResponse
from .task_catalog import AGENT_SPECS, allowed_tasks

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s %(message)s")
logging.getLogger("uvicorn.access").disabled = True
logger = logging.getLogger("python_brain")


def create_brain(cfg: BrainConfig, client: LLMClient) -> tuple[Any, str]:
    if LangChainSmartBrain is not None:
        return LangChainSmartBrain(cfg, client), "langchain_multi_agent"

    logger.warning(
        "LangChain smart brain unavailable; falling back to SmartBrain: %s",
        _LANGCHAIN_IMPORT_ERROR,
    )
    return SmartBrain(cfg, client), "smartbrain_fallback"


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = BrainConfig()
    http = httpx.AsyncClient(timeout=cfg.llm_timeout_s)
    client = LLMClient(cfg, http)
    brain, brain_runtime = create_brain(cfg, client)
    app.state.cfg = cfg
    app.state.client = client
    app.state.brain = brain
    app.state.brain_runtime = brain_runtime
    logger.info(
        "Python Smart Brain started on %s:%d | model=%s | llm=%s | parallel=%s | runtime=%s",
        cfg.host,
        cfg.port,
        cfg.llm_model,
        "enabled" if cfg.llm_enabled else "disabled",
        cfg.parallel_agents,
        brain_runtime,
    )
    yield
    await client.aclose()
    logger.info("Python Smart Brain stopped")


app = FastAPI(title="Minecraft Python Smart Brain", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health")
async def health(request: Request):
    cfg: BrainConfig = request.app.state.cfg
    return {
        "status": "ok",
        "service": "python_brain",
        "llmEnabled": cfg.llm_enabled,
        "parallelAgents": cfg.parallel_agents,
        "brainRuntime": getattr(request.app.state, "brain_runtime", "unknown"),
    }


@app.get("/config")
async def config_info(request: Request):
    cfg: BrainConfig = request.app.state.cfg
    return cfg.public_config


@app.get("/agents")
async def agents_info():
    return {
        "agents": [
            {"agentId": spec.agent_id, "title": spec.title, "tasks": list(spec.tasks), "activationHint": spec.activation_hint}
            for spec in AGENT_SPECS.values()
        ],
        "allowedTasks": allowed_tasks(),
    }


@app.post("/plan", response_model=PlanResponse)
async def plan(request_payload: BrainRequest, request: Request):
    brain = request.app.state.brain
    try:
        return await brain.plan(request_payload)
    except Exception as exc:
        logger.exception("planning failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def serve() -> None:
    cfg = BrainConfig()
    uvicorn.run("python_brain.main:app", host=cfg.host, port=cfg.port, reload=False, log_level="info", access_log=False)


if __name__ == "__main__":
    serve()
