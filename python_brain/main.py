"""
FastAPI server entry point for Python Smart Brain.

Endpoints
---------
POST /plan         — Main planning endpoint; Node.js posts a BotSnapshot here
GET  /health       — Health check (always returns 200 if the service is up)
GET  /config       — Displays non-secret runtime config
"""

from __future__ import annotations

import contextlib
import logging

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .brain import SmartBrain
from .config import BrainConfig
from .llm_client import LLMClient
from .models import BotSnapshot, PlanResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)
logger = logging.getLogger("python_brain")


# ---------------------------------------------------------------------------
# Application lifecycle
# ---------------------------------------------------------------------------

@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI):
    cfg = BrainConfig()
    http = httpx.AsyncClient(timeout=cfg.llm_timeout_s)
    client = LLMClient(cfg, http)
    brain = SmartBrain(cfg, client)

    app.state.cfg = cfg
    app.state.brain = brain
    app.state.client = client

    llm_status = "enabled" if cfg.llm_enabled else "disabled (rule-based fallback)"
    logger.info(
        "Python Smart Brain started on %s:%d | LLM=%s | model=%s | parallel=%s",
        cfg.host, cfg.port, llm_status, cfg.llm_model, cfg.parallel_agents,
    )
    yield

    await client.aclose()
    logger.info("Python Smart Brain shut down.")


app = FastAPI(
    title="Minecraft Python Smart Brain",
    version="0.1.0",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/config")
async def config_info(request: Request):
    cfg: BrainConfig = request.app.state.cfg
    return {
        "model": cfg.llm_model,
        "baseUrl": cfg.llm_base_url,
        "llmEnabled": cfg.llm_enabled,
        "parallelAgents": cfg.parallel_agents,
        "maxTreesPerResponse": cfg.max_trees_per_response,
    }


@app.post("/plan", response_model=PlanResponse)
async def plan(snapshot: BotSnapshot, request: Request):
    brain: SmartBrain = request.app.state.brain
    try:
        result = await brain.plan(snapshot)
    except Exception as exc:
        logger.exception("Unexpected error during planning")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return result


# ---------------------------------------------------------------------------
# Direct execution: python -m python_brain.main
# ---------------------------------------------------------------------------

def serve():
    cfg = BrainConfig()
    uvicorn.run(
        "python_brain.main:app",
        host=cfg.host,
        port=cfg.port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    serve()
