"""Pydantic models for the Python Smart Brain API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .task_catalog import agent_for_task, normalize_task_type, task_function_name, task_level, task_priority, tree_class_name


class BrainBaseModel(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class Position(BrainBaseModel):
    x: float
    y: float
    z: float


class EntityInfo(BrainBaseModel):
    name: str = ""
    distance: float | None = None
    position: Position | None = None
    hostile: bool = False


class RuleDecision(BrainBaseModel):
    type: str
    reason: str | None = None
    priority: int | None = None
    target: str | None = None


class TaskFeedback(BrainBaseModel):
    lastEvent: Any = None
    blockedTasks: list[dict[str, Any]] = Field(default_factory=list)
    recentFailures: list[dict[str, Any]] = Field(default_factory=list)


class BotSnapshot(BrainBaseModel):
    position: Position | None = None
    health: float = 20.0
    food: float = 20.0
    oxygen: float = 20.0
    isDay: bool = True
    isNight: bool = False
    timeOfDay: int = 0
    entities: list[EntityInfo] = Field(default_factory=list)
    inventory: dict[str, int] = Field(default_factory=dict)
    terrain: dict[str, Any] | None = None
    environmentHazard: dict[str, Any] | None = None
    navigationTrap: bool = False
    isInLava: bool = False
    isBodyInWater: bool = False

    @property
    def hostile_nearby(self) -> bool:
        return any(entity.hostile for entity in self.entities)

    @property
    def health_critical(self) -> bool:
        return self.health <= 6

    @property
    def food_low(self) -> bool:
        return self.food <= 8

    @property
    def oxygen_low(self) -> bool:
        return self.isBodyInWater and self.oxygen <= 8

    @property
    def has_wood(self) -> bool:
        return any(name.endswith("_log") or name == "log" for name, count in self.inventory.items() if count > 0)


class BrainRequest(BrainBaseModel):
    snapshot: BotSnapshot = Field(default_factory=BotSnapshot)
    ruleDecision: RuleDecision | None = None
    taskFeedback: TaskFeedback = Field(default_factory=TaskFeedback)
    progress: dict[str, Any] = Field(default_factory=dict)
    memory: dict[str, Any] = Field(default_factory=dict)
    controller: dict[str, Any] = Field(default_factory=dict)
    plannerContext: dict[str, Any] = Field(default_factory=dict)
    source: str = "node_controller"


class BehaviorTreeRequest(BrainBaseModel):
    taskType: str
    treeClass: str
    taskFunction: str
    constructorArgs: dict[str, Any] = Field(default_factory=dict)
    priority: int
    level: str = "D"
    reason: str | None = None
    sourceAgent: str = "general_agent"
    requestedBy: str = "general_agent"
    taskRequestId: str | None = None
    preconditions: list[str] = Field(default_factory=list)
    postconditions: list[str] = Field(default_factory=list)

    @classmethod
    def from_task(
        cls,
        task_type: str,
        *,
        source_agent: str | None = None,
        requested_by: str = "general_agent",
        reason: str | None = None,
        constructor_args: dict[str, Any] | None = None,
        task_request_id: str | None = None,
        preconditions: list[str] | None = None,
        postconditions: list[str] | None = None,
    ) -> "BehaviorTreeRequest | None":
        normalized = normalize_task_type(task_type)
        if not normalized:
            return None
        resolved_agent = source_agent or agent_for_task(normalized)
        return cls(
            taskType=normalized,
            treeClass=tree_class_name(normalized),
            taskFunction=task_function_name(normalized),
            constructorArgs=constructor_args or {},
            priority=task_priority(normalized),
            level=task_level(normalized),
            reason=reason,
            sourceAgent=resolved_agent,
            requestedBy=requested_by,
            taskRequestId=task_request_id,
            preconditions=preconditions or [],
            postconditions=postconditions or [],
        )


class AgentProposal(BrainBaseModel):
    agentId: str
    active: bool
    reason: str | None = None
    trees: list[BehaviorTreeRequest] = Field(default_factory=list)
    durationMs: float = 0.0
    error: str | None = None


class PlanResponse(BrainBaseModel):
    brainAgent: str = "general_agent"
    stageAssessment: str = ""
    agentProposals: list[AgentProposal] = Field(default_factory=list)
    taskRequests: list[BehaviorTreeRequest] = Field(default_factory=list)
    behaviorTrees: list[BehaviorTreeRequest] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    confidence: float = 0.8
    durationMs: float = 0.0
