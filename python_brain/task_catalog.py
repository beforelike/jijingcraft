"""Task catalog shared by the Python Smart Brain agents.

The Node.js controller remains the source of truth for executable behavior trees.
This catalog mirrors task names and priority ordering so Python can reason about
agent domains without receiving direct Mineflayer permissions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


TASK_PRIORITIES: dict[str, int] = {
    "escape_hazard": 1000,
    "escape_pit": 990,
    "descend_from_platform": 985,
    "eat_food": 980,
    "recover_starvation": 970,
    "evade_hostiles": 960,
    "defend_shelter": 950,
    "defend_self": 940,
    "wait_out_night": 760,
    "hold_position": 740,
    "hunt_food": 680,
    "collect_wood": 620,
    "craft_basic_supplies": 600,
    "craft_basic_tools": 590,
    "collect_stone": 580,
    "craft_stone_tools": 570,
    "craft_furnace": 560,
    "craft_weapon": 550,
    "collect_building_materials": 500,
    "build_shelter": 490,
    "collect_wool": 460,
    "craft_bed": 450,
    "collect_crop_seeds": 430,
    "plant_crops": 420,
    "build_animal_pen": 410,
    "lure_animals": 400,
    "mine_advanced_materials": 360,
    "explore": 120,
}

TASK_ALIASES: dict[str, str] = {
    "safe_explore": "explore",
    "safe_exploration": "explore",
    "explore_environment": "explore",
    "explore_area": "explore",
    "descend_to_water": "descend_from_platform",
    "platform_descent": "descend_from_platform",
    "collect_logs": "collect_wood",
    "chop_tree": "collect_wood",
    "chop_wood": "collect_wood",
    "forage_food": "hunt_food",
}

TASK_TREE_CLASS_OVERRIDES: dict[str, str] = {
    "escape_hazard": "EscapeHazardTree",
    "escape_pit": "EscapePitTree",
    "descend_from_platform": "DescendFromPlatformTree",
    "eat_food": "EatFoodTree",
    "recover_starvation": "RecoverStarvationTree",
    "evade_hostiles": "EvadeHostilesTree",
    "defend_shelter": "DefendShelterTree",
    "defend_self": "DefendSelfTree",
    "wait_out_night": "WaitOutNightTree",
    "hold_position": "HoldPositionTree",
    "hunt_food": "HuntFoodTree",
    "collect_wood": "CollectWoodTree",
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
    "collect_crop_seeds": "CollectCropSeedsTree",
    "plant_crops": "PlantCropsTree",
    "build_animal_pen": "BuildAnimalPenTree",
    "lure_animals": "LureAnimalsTree",
    "mine_advanced_materials": "MineAdvancedMaterialsTree",
    "explore": "ExploreTree",
}


@dataclass(frozen=True)
class AgentSpec:
    agent_id: str
    title: str
    tasks: tuple[str, ...]
    activation_hint: str
    prompt_hint: str


AGENT_SPECS: dict[str, AgentSpec] = {
    "safety_agent": AgentSpec(
        agent_id="safety_agent",
        title="Safety Agent",
        tasks=("escape_hazard", "escape_pit", "descend_from_platform", "eat_food", "recover_starvation"),
        activation_hint="hazards, pits, elevated platforms, low health, starvation, oxygen, or rule safety tasks",
        prompt_hint="Prefer direct safety stabilization and platform descent before long travel or crafting work.",
    ),
    "combat_agent": AgentSpec(
        agent_id="combat_agent",
        title="Combat Agent",
        tasks=("evade_hostiles", "defend_shelter", "defend_self"),
        activation_hint="nearby hostile mobs or shelter defense pressure",
        prompt_hint="Prefer evasion; only choose defend_self when melee danger cannot be avoided.",
    ),
    "survival_agent": AgentSpec(
        agent_id="survival_agent",
        title="Survival Agent",
        tasks=("hunt_food", "collect_wood", "explore", "wait_out_night", "hold_position"),
        activation_hint="food, wood, exploration, and night waiting decisions",
        prompt_hint="Use terrain-aware food strategy. Request explore when resources are unknown.",
    ),
    "engineering_agent": AgentSpec(
        agent_id="engineering_agent",
        title="Engineering Agent",
        tasks=(
            "craft_basic_supplies",
            "craft_basic_tools",
            "collect_stone",
            "craft_stone_tools",
            "craft_furnace",
            "craft_weapon",
            "collect_building_materials",
            "build_shelter",
            "collect_wool",
            "craft_bed",
            "collect_crop_seeds",
            "plant_crops",
            "build_animal_pen",
            "lure_animals",
            "mine_advanced_materials",
        ),
        activation_hint="crafting, mining, shelter, farming, and base development decisions",
        prompt_hint="Do not request tasks that need missing prerequisites unless the task obtains them.",
    ),
}


def allowed_tasks() -> list[str]:
    return list(TASK_PRIORITIES)


def normalize_task_type(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    task_type = value.strip()
    task_type = TASK_ALIASES.get(task_type, task_type)
    return task_type if task_type in TASK_PRIORITIES else None


def task_priority(task_type: str) -> int:
    return TASK_PRIORITIES.get(task_type, 0)


def task_level(task_type: str) -> str:
    priority = task_priority(task_type)
    if priority >= 900:
        return "S"
    if priority >= 700:
        return "A"
    if priority >= 550:
        return "B"
    if priority >= 400:
        return "C"
    return "D"


def _to_pascal_case(value: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in value.split("_") if part)


def _to_camel_case(value: str) -> str:
    pascal = _to_pascal_case(value)
    return pascal[:1].lower() + pascal[1:] if pascal else "executeTask"


def tree_class_name(task_type: str) -> str:
    return TASK_TREE_CLASS_OVERRIDES.get(task_type, f"{_to_pascal_case(task_type)}Tree")


def task_function_name(task_type: str) -> str:
    overrides = {
        "collect_wood": "collectWood",
        "collect_stone": "collectStone",
        "collect_building_materials": "collectBuildingMaterials",
        "hunt_food": "huntFood",
    }
    return overrides.get(task_type, _to_camel_case(task_type))


def agent_for_task(task_type: str) -> str:
    for spec in AGENT_SPECS.values():
        if task_type in spec.tasks:
            return spec.agent_id
    return "general_agent"
