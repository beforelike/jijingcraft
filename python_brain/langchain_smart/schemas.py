"""Strict planner output schemas for the LangChain smart brain."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TaskDraft(StrictModel):
    taskType: str = Field(description="One allowed task id from the catalog.")
    reason: str = Field(default="", max_length=180)
    priorityHint: int | None = Field(default=None, ge=0, le=1000)
    constructorArgs: dict[str, Any] = Field(default_factory=dict)


class StagePlan(StrictModel):
    stage: str = Field(default="unknown", max_length=60)
    ruleTask: str | None = Field(default=None, max_length=80)
    activeAgents: list[Literal["safety_agent", "combat_agent", "survival_agent", "engineering_agent"]] = Field(default_factory=list)
    riskLevel: Literal["low", "medium", "high", "critical"] = "medium"
    objective: str = Field(default="", max_length=180)


class WorkerPlan(StrictModel):
    agentId: Literal["safety_agent", "combat_agent", "survival_agent", "engineering_agent"]
    active: bool = True
    reason: str = Field(default="", max_length=180)
    tasks: list[TaskDraft] = Field(default_factory=list, max_length=3)


class GeneralPlan(StrictModel):
    stageAssessment: str = Field(default="", max_length=240)
    selectedTasks: list[TaskDraft] = Field(default_factory=list, max_length=4)
    confidence: float = Field(default=0.7, ge=0, le=1)


class JudgePlan(StrictModel):
    score: float = Field(default=0.5, ge=0, le=1)
    acceptedTasks: list[str] = Field(default_factory=list, max_length=4)
    rejectedTasks: list[str] = Field(default_factory=list, max_length=8)
    notes: list[str] = Field(default_factory=list, max_length=4)