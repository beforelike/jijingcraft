"""LangGraph-based hierarchical task planner for MC Survival Bot.

Replaces the hand-written asyncio.gather agent system with:
  - StateGraph: StagePlanner → Workers → GeneralAgent → Judge → PromptOptimizer
  - Structured output via LangChain's with_structured_output
  - LLM-as-Judge feedback loop for continuous improvement
  - Shared state with cancellation and replanning support
"""

from .graph import build_planning_graph, PlanningState
from .brain import LangGraphBrain
from .prompts import (
    STAGE_PLANNER_SYSTEM,
    SAFETY_WORKER_SYSTEM,
    COMBAT_WORKER_SYSTEM,
    SURVIVAL_WORKER_SYSTEM,
    ENGINEERING_WORKER_SYSTEM,
    GENERAL_AGENT_SYSTEM,
    JUDGE_SYSTEM,
)

__all__ = [
    "build_planning_graph",
    "PlanningState",
    "LangGraphBrain",
    "STAGE_PLANNER_SYSTEM",
    "SAFETY_WORKER_SYSTEM",
    "COMBAT_WORKER_SYSTEM",
    "SURVIVAL_WORKER_SYSTEM",
    "ENGINEERING_WORKER_SYSTEM",
    "GENERAL_AGENT_SYSTEM",
    "JUDGE_SYSTEM",
]
