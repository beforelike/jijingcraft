"""Action catalog — registry of all available primitive actions.

Maps action type strings to their Python classes and metadata.
Used by the LangGraph agents to discover available actions and
by the ActionCompiler to instantiate actions from agent requests.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .base import PrimitiveAction
from .movement import JumpAction, SneakToAction, SwimAction, WalkAction
from .interaction import CollectAction, EatAction, MineAction, PickupAction, PlaceAction, UseItemAction
from .combat import AttackAction, DefendAction, FleeAction
from .crafting import CraftAction, SmeltAction
from .building import FillAreaAction, PlaceRowAction, PlaceWallAction
from .observation import CheckInventoryAction, ScanBlocksAction, ScanEntitiesAction
from .utility import DropAction, EquipAction, UnequipAction, WaitAction


@dataclass(frozen=True)
class ActionSpec:
    action_type: str
    action_class: type[PrimitiveAction]
    category: str          # movement, interaction, combat, crafting, building, observation, utility
    description: str
    required_params: tuple[str, ...]
    optional_params: tuple[str, ...]
    safety_level: str      # S (critical), A (important), B (normal)
    can_be_preempted: bool


ACTION_CATALOG: dict[str, ActionSpec] = {
    # ── Movement ──
    "walk": ActionSpec(
        action_type="walk", action_class=WalkAction, category="movement",
        description="Walk in a cardinal direction for N steps",
        required_params=("direction", "steps"),
        optional_params=("speed",),
        safety_level="B", can_be_preempted=True,
    ),
    "jump": ActionSpec(
        action_type="jump", action_class=JumpAction, category="movement",
        description="Perform a single jump, optionally in a direction",
        required_params=(),
        optional_params=("direction",),
        safety_level="B", can_be_preempted=True,
    ),
    "swim": ActionSpec(
        action_type="swim", action_class=SwimAction, category="movement",
        description="Swim in a direction for a distance",
        required_params=("direction", "distance"),
        optional_params=(),
        safety_level="A", can_be_preempted=False,
    ),
    "sneak_to": ActionSpec(
        action_type="sneak_to", action_class=SneakToAction, category="movement",
        description="Sneak carefully to a position (edges, cliffs)",
        required_params=("position",),
        optional_params=(),
        safety_level="A", can_be_preempted=False,
    ),

    # ── Interaction ──
    "mine": ActionSpec(
        action_type="mine", action_class=MineAction, category="interaction",
        description="Mine a block at a position with optional tool",
        required_params=("block_type", "position"),
        optional_params=("tool",),
        safety_level="B", can_be_preempted=True,
    ),
    "place": ActionSpec(
        action_type="place", action_class=PlaceAction, category="interaction",
        description="Place a block at a position on a face",
        required_params=("block_type", "position"),
        optional_params=("face",),
        safety_level="B", can_be_preempted=True,
    ),
    "eat": ActionSpec(
        action_type="eat", action_class=EatAction, category="interaction",
        description="Eat a food item from inventory",
        required_params=("food_item",),
        optional_params=(),
        safety_level="S", can_be_preempted=False,
    ),
    "use_item": ActionSpec(
        action_type="use_item", action_class=UseItemAction, category="interaction",
        description="Right-click with held item on block or entity",
        required_params=("item",),
        optional_params=("on_block", "on_entity"),
        safety_level="B", can_be_preempted=True,
    ),
    "collect": ActionSpec(
        action_type="collect", action_class=CollectAction, category="interaction",
        description="Collect N items of a type from ground drops",
        required_params=("item_type",),
        optional_params=("count",),
        safety_level="B", can_be_preempted=True,
    ),
    "pickup": ActionSpec(
        action_type="pickup", action_class=PickupAction, category="interaction",
        description="Pick up all nearby dropped items",
        required_params=(),
        optional_params=("radius",),
        safety_level="B", can_be_preempted=True,
    ),

    # ── Combat ──
    "attack": ActionSpec(
        action_type="attack", action_class=AttackAction, category="combat",
        description="Attack a target entity",
        required_params=("entity",),
        optional_params=("weapon",),
        safety_level="S", can_be_preempted=False,
    ),
    "defend": ActionSpec(
        action_type="defend", action_class=DefendAction, category="combat",
        description="Hold position and attack nearby hostiles",
        required_params=(),
        optional_params=("timeout_ms",),
        safety_level="S", can_be_preempted=False,
    ),
    "flee": ActionSpec(
        action_type="flee", action_class=FleeAction, category="combat",
        description="Run away from an entity for minimum distance",
        required_params=("from_entity", "distance"),
        optional_params=(),
        safety_level="S", can_be_preempted=False,
    ),

    # ── Crafting ──
    "craft": ActionSpec(
        action_type="craft", action_class=CraftAction, category="crafting",
        description="Craft N of an item using inventory or crafting table",
        required_params=("item_type",),
        optional_params=("count",),
        safety_level="B", can_be_preempted=True,
    ),
    "smelt": ActionSpec(
        action_type="smelt", action_class=SmeltAction, category="crafting",
        description="Smelt items in a furnace with fuel",
        required_params=("input_item",),
        optional_params=("fuel", "count"),
        safety_level="B", can_be_preempted=True,
    ),

    # ── Building ──
    "place_row": ActionSpec(
        action_type="place_row", action_class=PlaceRowAction, category="building",
        description="Place a row of blocks in a direction",
        required_params=("block_type", "start", "direction", "count"),
        optional_params=(),
        safety_level="B", can_be_preempted=True,
    ),
    "place_wall": ActionSpec(
        action_type="place_wall", action_class=PlaceWallAction, category="building",
        description="Place a vertical wall (width × height)",
        required_params=("block_type", "start", "direction", "width", "height"),
        optional_params=(),
        safety_level="B", can_be_preempted=True,
    ),
    "fill_area": ActionSpec(
        action_type="fill_area", action_class=FillAreaAction, category="building",
        description="Fill a 2D area with blocks",
        required_params=("block_type", "corner1", "corner2"),
        optional_params=(),
        safety_level="B", can_be_preempted=True,
    ),

    # ── Observation ──
    "scan_blocks": ActionSpec(
        action_type="scan_blocks", action_class=ScanBlocksAction, category="observation",
        description="Scan for specific block types within radius",
        required_params=(),
        optional_params=("radius", "block_types"),
        safety_level="B", can_be_preempted=True,
    ),
    "scan_entities": ActionSpec(
        action_type="scan_entities", action_class=ScanEntitiesAction, category="observation",
        description="Scan for entities within radius",
        required_params=(),
        optional_params=("radius", "types", "names"),
        safety_level="B", can_be_preempted=True,
    ),
    "check_inventory": ActionSpec(
        action_type="check_inventory", action_class=CheckInventoryAction, category="observation",
        description="Check inventory for specific items or full snapshot",
        required_params=(),
        optional_params=("items",),
        safety_level="B", can_be_preempted=True,
    ),

    # ── Utility ──
    "wait": ActionSpec(
        action_type="wait", action_class=WaitAction, category="utility",
        description="Wait for a duration in seconds",
        required_params=("seconds",),
        optional_params=(),
        safety_level="B", can_be_preempted=True,
    ),
    "equip": ActionSpec(
        action_type="equip", action_class=EquipAction, category="utility",
        description="Equip an item to main hand",
        required_params=("item_type",),
        optional_params=(),
        safety_level="B", can_be_preempted=True,
    ),
    "unequip": ActionSpec(
        action_type="unequip", action_class=UnequipAction, category="utility",
        description="Unequip held item",
        required_params=(),
        optional_params=(),
        safety_level="B", can_be_preempted=True,
    ),
    "drop": ActionSpec(
        action_type="drop", action_class=DropAction, category="utility",
        description="Drop items from inventory",
        required_params=("item_type",),
        optional_params=("count",),
        safety_level="B", can_be_preempted=True,
    ),
}


def get_action_class(action_type: str) -> type[PrimitiveAction] | None:
    spec = ACTION_CATALOG.get(action_type)
    return spec.action_class if spec else None


def list_actions(category: str | None = None) -> list[ActionSpec]:
    if category is None:
        return list(ACTION_CATALOG.values())
    return [s for s in ACTION_CATALOG.values() if s.category == category]


def list_categories() -> list[str]:
    return sorted({s.category for s in ACTION_CATALOG.values()})


def safety_actions() -> list[str]:
    return [s.action_type for s in ACTION_CATALOG.values() if s.safety_level == "S"]


def preemptible_actions() -> list[str]:
    return [s.action_type for s in ACTION_CATALOG.values() if s.can_be_preempted]
