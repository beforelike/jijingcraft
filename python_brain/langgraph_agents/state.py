"""Shared state for the LangGraph planning graph."""

from __future__ import annotations

from typing import Annotated, Any

from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field


class WorkerOutput(BaseModel):
    agent_id: str = ""
    active: bool = False
    reason: str = ""
    trees: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None
    duration_ms: float = 0.0


class JudgeReport(BaseModel):
    score: float = 0.0                # 0.0-1.0 overall decision quality
    issues: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    blocked_tasks_detected: bool = False
    missing_safety_concern: bool = False
    improvement_notes: str = ""


class PlanningState(BaseModel):
    """State shared across all nodes in the planning graph."""

    # Input
    compact_state: dict[str, Any] = Field(default_factory=dict)
    rule_decision: dict[str, Any] = Field(default_factory=dict)
    task_feedback: dict[str, Any] = Field(default_factory=dict)
    memory: dict[str, Any] = Field(default_factory=dict)
    progress: dict[str, Any] = Field(default_factory=dict)
    minecraft_wiki: str = ""

    # StagePlanner output
    stage_assessment: str = ""
    active_workers: list[str] = Field(default_factory=list)
    high_level_goal: str = ""

    # Worker outputs
    worker_outputs: dict[str, WorkerOutput] = Field(default_factory=dict)

    # GeneralAgent output
    merged_trees: list[dict[str, Any]] = Field(default_factory=list)
    merged_stage: str = ""

    # Judge output
    judge_report: JudgeReport = Field(default_factory=JudgeReport)

    # Accumulated improvement notes (survives across invocations)
    prompt_notes: list[dict[str, Any]] = Field(default_factory=list)

    # Chat message accumulator (for LangGraph add_messages reducer)
    messages: Annotated[list, add_messages] = Field(default_factory=list)

    # Final
    final_response: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None

    model_config = {"arbitrary_types_allowed": True}
