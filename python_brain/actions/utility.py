"""Utility primitives: wait, equip, unequip, drop."""

from __future__ import annotations

from dataclasses import dataclass

from .base import (
    DiagnoseCheck,
    DiagnoseDomain,
    DiagnoseSpec,
    MonitorMetric,
    MonitorSpec,
    PrimitiveAction,
)


@dataclass
class WaitAction(PrimitiveAction):
    """Wait for a duration (seconds).

    Example: wait(seconds=2.0)
    """
    action_type: str = "wait"
    seconds: float = 1.0

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.TIME_ELAPSED,
            check_interval_ms=200,
            stall_threshold_ms=int(self.seconds * 1000) + 500,
            min_progress_per_check=0.0,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[])


@dataclass
class EquipAction(PrimitiveAction):
    """Equip an item to the main hand.

    Example: equip(item_type="stone_axe")
    """
    action_type: str = "equip"
    item_type: str = ""

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.ITEM_EQUIPPED,
            check_interval_ms=200,
            stall_threshold_ms=1000,
            min_progress_per_check=1.0,
            extra_params={"itemType": self.item_type},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=1,
                          check_name=self.item_type, check_count=1),
        ])


@dataclass
class UnequipAction(PrimitiveAction):
    """Unequip the currently held item (move to offhand or inventory).

    Example: unequip()
    """
    action_type: str = "unequip"

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.ITEM_EQUIPPED,
            check_interval_ms=200,
            stall_threshold_ms=500,
            min_progress_per_check=1.0,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[])


@dataclass
class DropAction(PrimitiveAction):
    """Drop items from inventory.

    Example: drop(item_type="cobblestone", count=4)
    """
    action_type: str = "drop"
    item_type: str = ""
    count: int = 1

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.INVENTORY_COUNT,
            check_interval_ms=200,
            stall_threshold_ms=1000,
            min_progress_per_check=1,
            extra_params={"itemType": self.item_type, "direction": "decrease"},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=1,
                          check_name=self.item_type, check_count=self.count),
        ])
