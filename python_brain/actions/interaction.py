"""Interaction primitives: mine, place, eat, use, collect, pickup."""

from __future__ import annotations

from dataclasses import dataclass, field

from .base import (
    DiagnoseCheck,
    DiagnoseDomain,
    DiagnoseSpec,
    MonitorMetric,
    MonitorSpec,
    PrimitiveAction,
)


@dataclass
class MineAction(PrimitiveAction):
    """Mine a block at a position, optionally with a preferred tool.

    Example: mine(block_type="oak_log", position={"x": 12, "y": 64, "z": -3}, tool="stone_axe")
    """
    action_type: str = "mine"
    block_type: str = ""
    position: dict[str, float] = field(default_factory=dict)
    tool: str | None = None

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.BLOCK_BREAKING,
            check_interval_ms=200,
            stall_threshold_ms=2000,
            min_progress_per_check=0.1,
            extra_params={"blockType": self.block_type, "position": self.position},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.TOOL_CHECK, priority=1,
                          check_name=self.tool,
                          extra_params={"block_type": self.block_type}),
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_TARGET, priority=2,
                          offset=self.position, check_name=self.block_type),
            DiagnoseCheck(domain=DiagnoseDomain.POSITION_CHECK, priority=3),
        ])


@dataclass
class PlaceAction(PrimitiveAction):
    """Place a block at a position.

    Example: place(block_type="oak_planks", position={"x": 10, "y": 64, "z": 0}, face="up")
    """
    action_type: str = "place"
    block_type: str = ""
    position: dict[str, float] = field(default_factory=dict)
    face: str = "up"

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.BLOCK_PLACED,
            check_interval_ms=200,
            stall_threshold_ms=2000,
            min_progress_per_check=1.0,
            extra_params={"blockType": self.block_type, "position": self.position},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_TARGET, priority=1,
                          offset=self.position, check_solid=True),
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=2,
                          check_name=self.block_type, check_count=1),
            DiagnoseCheck(domain=DiagnoseDomain.POSITION_CHECK, priority=3),
        ])


@dataclass
class EatAction(PrimitiveAction):
    """Eat a food item from inventory.

    Example: eat(food_item="cooked_beef")
    """
    action_type: str = "eat"
    food_item: str = ""

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.BOT_FOOD,
            check_interval_ms=200,
            stall_threshold_ms=2000,
            min_progress_per_check=0.1,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=1,
                          check_name=self.food_item, check_count=1),
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=2,
                          extra_params={"check_food_full": True}),
        ])


@dataclass
class UseItemAction(PrimitiveAction):
    """Use a held item (right-click) on a target block or entity.

    Example: use_item(item="flint_and_steel", on_block={"x":0,"y":64,"z":0})
    """
    action_type: str = "use_item"
    item: str = ""
    on_block: dict[str, float] | None = None
    on_entity: dict[str, str] | None = None  # {name, id}

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.TIME_ELAPSED,
            check_interval_ms=200,
            stall_threshold_ms=1000,
            min_progress_per_check=0.0,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=1,
                          check_name=self.item, check_count=1),
            DiagnoseCheck(domain=DiagnoseDomain.POSITION_CHECK, priority=2),
        ])


@dataclass
class CollectAction(PrimitiveAction):
    """Collect N items of a specific type (from ground drops).

    Example: collect(item_type="oak_log", count=4)
    """
    action_type: str = "collect"
    item_type: str = ""
    count: int = 1

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.INVENTORY_COUNT,
            check_interval_ms=300,
            stall_threshold_ms=3000,
            min_progress_per_check=1,
            target_value=float(self.count),
            extra_params={"itemType": self.item_type},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.ENTITY_NEARBY, priority=1,
                          extra_params={"radius": 5, "check_drops": True,
                                        "item_type": self.item_type}),
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=2,
                          extra_params={"check_full": True}),
        ])


@dataclass
class PickupAction(PrimitiveAction):
    """Pick up all nearby dropped items.

    Example: pickup(radius=3)
    """
    action_type: str = "pickup"
    radius: float = 3.0

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.INVENTORY_COUNT,
            check_interval_ms=200,
            stall_threshold_ms=1500,
            min_progress_per_check=1,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.ENTITY_NEARBY, priority=1,
                          extra_params={"radius": self.radius, "check_drops": True}),
        ])
