"""
Pydantic data models shared across the Python Smart Brain.
Mirrors the JavaScript BehaviorTree/TaskRequest envelope format so
Node.js can consume responses without any conversion on its side.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class AgentId(str, Enum):
    GENERAL = "general_agent"
    SAFETY = "safety_agent"
    COMBAT = "combat_agent"
    SURVIVAL = "survival_agent"
    ENGINEERING = "engineering_agent"


class TaskType(str, Enum):
    # Safety
    ESCAPE_HAZARD = "escape_hazard"
    ESCAPE_PIT = "escape_pit"
    EAT_FOOD = "eat_food"
    RECOVER_STARVATION = "recover_starvation"
    # Combat
    EVADE_HOSTILES = "evade_hostiles"
    DEFEND_SHELTER = "defend_shelter"
    DEFEND_SELF = "defend_self"
    # Survival
    HUNT_FOOD = "hunt_food"
    COLLECT_WOOD = "collect_wood"
    EXPLORE = "explore"
    WAIT_OUT_NIGHT = "wait_out_night"
    HOLD_POSITION = "hold_position"
    # Engineering
    CRAFT_BASIC_SUPPLIES = "craft_basic_supplies"
    CRAFT_BASIC_TOOLS = "craft_basic_tools"
    COLLECT_STONE = "collect_stone"
    CRAFT_STONE_TOOLS = "craft_stone_tools"
    CRAFT_FURNACE = "craft_furnace"
    CRAFT_WEAPON = "craft_weapon"
    COLLECT_BUILDING_MATERIALS = "collect_building_materials"
    BUILD_SHELTER = "build_shelter"
    COLLECT_WOOL = "collect_wool"
    CRAFT_BED = "craft_bed"


# Priority table (lower number = higher priority, matches JS taskPriority())
_PRIORITY: dict[str, int] = {
    "escape_hazard": 1,
    "escape_pit": 1,
    "eat_food": 2,
    "recover_starvation": 2,
    "evade_hostiles": 3,
    "defend_self": 3,
    "defend_shelter": 4,
    "hunt_food": 5,
    "collect_wood": 6,
    "explore": 7,
    "wait_out_night": 7,
    "hold_position": 8,
    "craft_basic_supplies": 9,
    "craft_basic_tools": 9,
    "collect_stone": 10,
    "craft_stone_tools": 10,
    "craft_furnace": 11,
    "craft_weapon": 11,
    "collect_building_materials": 12,
    "build_shelter": 12,
    "collect_wool": 13,
    "craft_bed": 13,
}

_TREE_CLASS: dict[str, str] = {
    "escape_hazard": "EscapeHazardTree",
    "escape_pit": "EscapePitTree",
    "eat_food": "EatFoodTree",
    "recover_starvation": "RecoverStarvationTree",
    "evade_hostiles": "EvadeHostilesTree",
    "defend_shelter": "DefendShelterTree",
    "defend_self": "DefendSelfTree",
    "hunt_food": "HuntFoodTree",
    "collect_wood": "CollectWoodTree",
    "explore": "ExploreTree",
    "wait_out_night": "WaitOutNightTree",
    "hold_position": "HoldPositionTree",
    "craft_basic_supplies": "CraftBasicSuppliesTree",
    "craft_basic_tools": "CraftBasicToolsTree",
    "collect_stone": "CollectStoneTree",
    "craft_stone_tools": "CraftStoneToolsTree",
    "craft_furnace": "CraftFurnaceTree",
    "craft_weapon": "CraftWeaponTree",
    "collect_building_materials": "CollectBuildingMaterialsTree",
    "build_shelter": "BuildShelterTree",
    "collect_wool": "CollectWoolTree",
    "craft_bed": "CraftBedTree",
}


def task_priority(task_type: str) -> int:
    return _PRIORITY.get(task_type, 99)


def tree_class_name(task_type: str) -> str:
    return _TREE_CLASS.get(task_type, f"{task_type.title().replace('_', '')}Tree")


def task_function_name(task_type: str) -> str:
    return f"task_{task_type}"


# ---------------------------------------------------------------------------
# Snapshot (input from Node.js)
# ---------------------------------------------------------------------------

class Position(BaseModel):
    x: float
    y: float
    z: float


class EntityInfo(BaseModel):
    name: str
    distance: float | None = None
    position: Position | None = None
    hostile: bool = False


class InventoryItem(BaseModel):
    name: str
    count: int


class RuleDecision(BaseModel):
    type: str
    reason: str | None = None
    priority: int | None = None


class TaskFeedback(BaseModel):
    lastEvent: str | None = None
    blockedTasks: list[dict[str, Any]] = Field(default_factory=list)
    recentFailures: list[dict[str, Any]] = Field(default_factory=list)


class BotSnapshot(BaseModel):
    """
    World snapshot sent from Node.js every planning cycle.
    Mirrors contextBuilder.js output.
    """
    position: Position | None = None
    health: float = 20.0
    food: float = 20.0
    isDay: bool = True
    timeOfDay: int = 0
    entities: list[EntityInfo] = Field(default_factory=list)
    inventory: dict[str, int] = Field(default_factory=dict)
    ruleDecision: RuleDecision | None = None
    taskFeedback: TaskFeedback | None = None
    memory: dict[str, Any] = Field(default_factory=dict)
    terrain: dict[str, Any] | None = None

    @property
    def hostile_nearby(self) -> bool:
        return any(e.hostile for e in self.entities)

    @property
    def health_critical(self) -> bool:
        return self.health <= 6

    @property
    def food_low(self) -> bool:
        return self.food <= 8

    @property
    def has_wood(self) -> bool:
        return any(
            k in ("log", "oak_log", "birch_log", "spruce_log", "jungle_log",
                  "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log")
            and v > 0
            for k, v in self.inventory.items()
        )


# ---------------------------------------------------------------------------
# Output (behavior tree request sent back to Node.js)
# ---------------------------------------------------------------------------

class ConstructorArgs(BaseModel):
    """Free-form parameters forwarded to the JS tree constructor."""
    model_config = {"extra": "allow"}


class BehaviorTreeRequest(BaseModel):
    taskType: str
    treeClass: str
    taskFunction: str
    constructorArgs: dict[str, Any] = Field(default_factory=dict)
    priority: int
    level: int = 1
    reason: str | None = None
    sourceAgent: str | None = None
    requestedBy: str | None = None

    @classmethod
    def from_task(
        cls,
        task_type: str,
        *,
        source_agent: str = "general_agent",
        reason: str | None = None,
        constructor_args: dict[str, Any] | None = None,
    ) -> "BehaviorTreeRequest":
        return cls(
            taskType=task_type,
            treeClass=tree_class_name(task_type),
            taskFunction=task_function_name(task_type),
            constructorArgs=constructor_args or {},
            priority=task_priority(task_type),
            reason=reason,
            sourceAgent=source_agent,
            requestedBy=source_agent,
        )


class AgentProposal(BaseModel):
    agentId: str
    active: bool
    reason: str | None = None
    trees: list[BehaviorTreeRequest] = Field(default_factory=list)
    durationMs: float = 0.0


class PlanResponse(BaseModel):
    """
    Full response returned to Node.js POST /plan.
    The `behaviorTrees` list is sorted by priority (ascending = higher priority first).
    """
    brainAgent: str = "general_agent"
    stageAssessment: str = ""
    agentProposals: list[AgentProposal] = Field(default_factory=list)
    behaviorTrees: list[BehaviorTreeRequest] = Field(default_factory=list)
    confidence: float = 0.8
    durationMs: float = 0.0
