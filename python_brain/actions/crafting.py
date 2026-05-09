"""Crafting primitives: craft, smelt."""

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
class CraftAction(PrimitiveAction):
    """Craft N of an item using available inventory.

    Example: craft(item_type="oak_planks", count=8)
    """
    action_type: str = "craft"
    item_type: str = ""
    count: int = 1

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.INVENTORY_COUNT,
            check_interval_ms=200,
            stall_threshold_ms=2000,
            min_progress_per_check=1,
            target_value=float(self.count),
            extra_params={"itemType": self.item_type},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=1,
                          extra_params={"check_recipe": True, "item_type": self.item_type}),
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=2,
                          extra_params={"check_crafting_table": True}),
        ])


@dataclass
class SmeltAction(PrimitiveAction):
    """Smelt an item using a furnace with fuel.

    Example: smelt(input_item="raw_iron", fuel="coal", count=3)
    """
    action_type: str = "smelt"
    input_item: str = ""
    fuel: str = "coal"
    count: int = 1

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.INVENTORY_COUNT,
            check_interval_ms=500,
            stall_threshold_ms=10000,  # smelting is slow
            min_progress_per_check=0,
            extra_params={"outputItem": self._smelt_output()},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=1,
                          check_name=self.input_item, check_count=1),
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=2,
                          check_name=self.fuel, check_count=1),
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=3,
                          extra_params={"check_furnace": True}),
        ])

    def _smelt_output(self) -> str:
        mapping: dict[str, str] = {
            "raw_iron": "iron_ingot",
            "raw_copper": "copper_ingot",
            "raw_gold": "gold_ingot",
            "sand": "glass",
            "cobblestone": "stone",
        }
        return mapping.get(self.input_item, f"cooked_{self.input_item}")
